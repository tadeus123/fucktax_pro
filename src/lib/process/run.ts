import { logAppEvent } from "@/lib/app-events";
import { dedupeBankRows, parseBankCsv, type ParsedBankRow } from "@/lib/process/bank-csv";
import { extractDocument, shouldSkipDocumentFile, type DocumentExtraction } from "@/lib/process/documents";
import { waitForOpenAiThrottle } from "@/lib/openai-client";
import type { ProcessedDocumentSummary, ProcessResult } from "@/lib/process/types";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { inferSupplierFromFilename, matchesVendorPattern } from "@/lib/vat/vendor-match";
import { autoApplyUploadedDocumentsToElster } from "@/lib/vat/auto-file-documents";
import { repairBrokenSupplierRecords } from "@/lib/vat/repair-supplier-records";

type UploadedFileRow = {
  id: string;
  kind: "document" | "bank";
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  created_at: string;
  processing_status?: string;
};

function assertOpenAiConfigured(): void {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "OPENAI_API_KEY is not configured — invoice extraction cannot run. Add it in Vercel env settings.",
    );
  }
}

async function supersedeDuplicateFilenameRecords(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  filingPeriodId: string,
  sessionId: string,
  batch: UploadedFileRow[],
): Promise<void> {
  for (const file of batch) {
    const { data: older } = await supabase
      .from("uploaded_files")
      .select("id")
      .eq("session_id", sessionId)
      .eq("original_filename", file.original_filename)
      .neq("id", file.id);

    const oldIds = (older ?? []).map((row) => row.id);
    if (oldIds.length === 0) continue;

    await supabase
      .from("document_records")
      .delete()
      .eq("filing_period_id", filingPeriodId)
      .in("file_id", oldIds);
  }
}

async function resolveDocumentFilesToProcess(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  filingPeriodId: string,
  fileIds?: string[],
): Promise<UploadedFileRow[]> {
  const { data: files } = await supabase
    .from("uploaded_files")
    .select(
      "id, kind, storage_bucket, storage_path, original_filename, mime_type, created_at, processing_status",
    )
    .eq("session_id", sessionId)
    .eq("kind", "document")
    .order("created_at", { ascending: false });

  const allFiles = (files ?? []) as UploadedFileRow[];

  if (fileIds?.length) {
    const idSet = new Set(fileIds);
    const batch = allFiles.filter((file) => idSet.has(file.id));
    if (batch.length === 0) {
      throw new Error("Uploaded files not found in session — try uploading again.");
    }
    return batch;
  }

  const { data: existingRecords } = await supabase
    .from("document_records")
    .select("file_id")
    .eq("filing_period_id", filingPeriodId);

  const processedFileIds = new Set((existingRecords ?? []).map((row) => row.file_id));

  return dedupeFilesByName(
    allFiles.filter(
      (file) =>
        file.processing_status === "pending" ||
        file.processing_status === "failed" ||
        !processedFileIds.has(file.id),
    ),
  );
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs(da.getTime() - db.getTime()) / 86400000;
}

function dedupeFilesByName(files: UploadedFileRow[]): UploadedFileRow[] {
  const seen = new Set<string>();
  const unique: UploadedFileRow[] = [];
  for (const file of files) {
    const key = file.original_filename.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
  }
  return unique;
}

function looksLikeDateOnly(text: string): boolean {
  return /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(text.trim());
}

function parseInvoiceDateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseInvoiceNumberFromFilename(filename: string): string | null {
  const match = filename.match(/\b(to\d{6,})\b/i);
  return match?.[1] ?? null;
}

function enrichExtractionFromFilename(
  filename: string,
  extraction: DocumentExtraction,
): DocumentExtraction {
  const supplier = inferSupplierFromFilename(filename);
  const invoiceDateFromFile = parseInvoiceDateFromFilename(filename);
  const invoiceNumberFromFile = parseInvoiceNumberFromFilename(filename);

  let next: DocumentExtraction = { ...extraction };

  if (invoiceDateFromFile && !next.invoice_date) {
    next.invoice_date = invoiceDateFromFile;
  }
  if (invoiceNumberFromFile && !next.invoice_number) {
    next.invoice_number = invoiceNumberFromFile;
  }

  if (!supplier) return next;

  const cp = next.counterparty_name ?? "";
  const cpIsCustomer = /huge production/i.test(cp);
  const cpIsSupplier =
    matchesVendorPattern(cp, supplier) || matchesVendorPattern(cp, "tokenize");
  const cpIsBad =
    cpIsCustomer ||
    !cp.trim() ||
    looksLikeDateOnly(cp) ||
    (next.invoice_date != null && cp.trim() === next.invoice_date.trim());

  if (cpIsSupplier && !cpIsBad) return next;

  if (cpIsBad) {
    next = {
      ...next,
      counterparty_name: supplier,
      document_type:
        next.document_type === "other" ? "supplier_invoice" : next.document_type,
      vat_case: next.vat_case ?? "de_supplier_19",
      confidence:
        next.confidence === "do_not_deduct" &&
        (next.gross_amount != null || next.net_amount != null || next.vat_amount != null)
          ? "likely"
          : next.confidence === "review" && (next.gross_amount != null || next.net_amount != null)
            ? "likely"
            : next.confidence,
    };
  }

  return next;
}

function bankAmountMatchesDocument(
  txAmount: number,
  gross: number | null,
  vat: number | null,
): boolean {
  const candidates = [gross, vat].filter((v): v is number => v != null && v > 0);
  if (candidates.length === 0) return false;

  for (const val of candidates) {
    if (Math.abs(Math.abs(txAmount) - val) <= 0.05) return true;
    if (Math.abs(txAmount + val) <= 0.05) return true;
    if (Math.abs(txAmount - val) <= 0.05) return true;
  }
  return false;
}

function scoreDocumentBankMatch(
  doc: {
    gross_amount: number | null;
    vat_amount: number | null;
    invoice_date: string | null;
    payment_date: string | null;
    counterparty_name: string | null;
  },
  tx: {
    amount: number;
    transaction_date: string;
    description: string | null;
    counterparty: string | null;
  },
  filename: string,
): number {
  const gross = doc.gross_amount != null ? Number(doc.gross_amount) : null;
  const vat = doc.vat_amount != null ? Number(doc.vat_amount) : null;
  const amount = Number(tx.amount);

  if (!bankAmountMatchesDocument(amount, gross, vat)) return 0;

  let score = 10;
  const docText = `${filename} ${doc.counterparty_name ?? ""}`;
  const txText = `${tx.description ?? ""} ${tx.counterparty ?? ""}`;

  if (matchesVendorPattern(docText, txText) || matchesVendorPattern(txText, docText)) {
    score += 8;
  }
  if (matchesVendorPattern(docText, "tokenize") && matchesVendorPattern(txText, "tokenize")) {
    score += 5;
  }
  if (matchesVendorPattern(filename, "tokenize") && matchesVendorPattern(txText, "tokenize")) {
    score += 6;
  }

  const docDate = doc.payment_date ?? doc.invoice_date;
  if (docDate) {
    const days = daysBetween(String(docDate), tx.transaction_date);
    if (days <= 28) score += 3;
    else if (days > 90) score -= 4;
  }

  return score;
}

function filterBankRowsToPeriod(
  rows: ParsedBankRow[],
  periodStart: string,
  periodEnd: string,
): ParsedBankRow[] {
  return rows.filter(
    (row) => row.transactionDate >= periodStart && row.transactionDate <= periodEnd,
  );
}

async function clearPreviousResults(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  filingPeriodId: string,
) {
  await supabase.from("document_records").delete().eq("filing_period_id", filingPeriodId);
  await supabase.from("bank_transactions").delete().eq("session_id", sessionId);
  await supabase.from("vat_summaries").delete().eq("session_id", sessionId);
}

async function processBankFiles(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  bankFiles: UploadedFileRow[],
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const csvFiles = bankFiles.filter((f) => f.original_filename.toLowerCase().endsWith(".csv"));

  let bestRows: ParsedBankRow[] = [];
  let sourceFileId: string | null = null;

  for (const file of csvFiles) {
    const { data: blob, error } = await supabase.storage
      .from(file.storage_bucket)
      .download(file.storage_path);

    if (error || !blob) continue;

    const buffer = Buffer.from(await blob.arrayBuffer());
    const rows = filterBankRowsToPeriod(parseBankCsv(buffer), periodStart, periodEnd);

    if (rows.length > bestRows.length) {
      bestRows = rows;
      sourceFileId = file.id;
    }
  }

  const unique = dedupeBankRows(bestRows);
  if (unique.length === 0) return 0;

  const { error } = await supabase.from("bank_transactions").insert(
    unique.map((row) => ({
      session_id: sessionId,
      source_file_id: sourceFileId,
      transaction_date: row.transactionDate,
      value_date: row.valueDate,
      amount: row.amount,
      currency: row.currency,
      description: row.description,
      counterparty: row.counterparty,
      reference: row.reference,
      reconciliation_status: "unmatched",
    })),
  );

  if (error) throw new Error(`Bank insert failed: ${error.message}`);
  return unique.length;
}

async function processDocumentFiles(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  filingPeriodId: string,
  documentFiles: UploadedFileRow[],
  periodStart: string,
  periodEnd: string,
): Promise<{
  processed: number;
  needsReview: number;
  skipped: number;
  outcomes: ProcessedDocumentSummary[];
  failures: string[];
}> {
  let processed = 0;
  let needsReview = 0;
  let skipped = 0;
  const outcomes: ProcessedDocumentSummary[] = [];
  const failures: string[] = [];

  for (const file of documentFiles) {
    if (processed + skipped + failures.length > 0) {
      await waitForOpenAiThrottle();
    }

    const baseOutcome = {
      filename: file.original_filename,
      counterparty: null as string | null,
      grossAmount: null as number | null,
      vatAmount: null as number | null,
      invoiceNumber: null as string | null,
      matchedBank: false,
      confidence: "review",
    };

    if (shouldSkipDocumentFile(file.original_filename)) {
      skipped += 1;
      await supabase
        .from("uploaded_files")
        .update({ processing_status: "done", error_message: "Skipped non-document type" })
        .eq("id", file.id);
      outcomes.push({
        ...baseOutcome,
        status: "skipped",
        error: "Not an invoice PDF/image — skipped.",
      });
      continue;
    }

    await supabase
      .from("uploaded_files")
      .update({ processing_status: "processing", error_message: null })
      .eq("id", file.id);

    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(file.storage_bucket)
        .download(file.storage_path);

      if (downloadError || !blob) {
        throw new Error(downloadError?.message ?? "Download failed");
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      let extraction = await extractDocument(file.original_filename, file.mime_type, buffer, {
        periodStart,
        periodEnd,
      });
      extraction = enrichExtractionFromFilename(file.original_filename, extraction);

      if (extraction.confidence === "do_not_deduct" && extraction.document_type === "other") {
        skipped += 1;
        await supabase
          .from("uploaded_files")
          .update({ processing_status: "done", error_message: extraction.warning })
          .eq("id", file.id);
        outcomes.push({
          ...baseOutcome,
          counterparty: extraction.counterparty_name,
          status: "skipped",
          error: extraction.warning ?? "Document skipped (not a deductible invoice).",
        });
        continue;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("document_records")
        .insert({
          file_id: file.id,
          filing_period_id: filingPeriodId,
          document_type: extraction.document_type,
          counterparty_name: extraction.counterparty_name,
          invoice_number: extraction.invoice_number,
          invoice_date: extraction.invoice_date,
          leistungsdatum: extraction.leistungsdatum,
          net_amount: extraction.net_amount,
          vat_rate: extraction.vat_rate,
          vat_amount: extraction.vat_amount,
          gross_amount: extraction.gross_amount,
          currency: extraction.currency,
          country: extraction.country,
          vat_id: extraction.vat_id,
          reverse_charge_text: extraction.reverse_charge_text,
          counterparty_type: extraction.counterparty_type,
          vat_shown: extraction.vat_shown,
          vat_treatment: extraction.vat_treatment,
          confidence: extraction.confidence,
          warning: extraction.warning,
          risk_status: extraction.vat_case,
          raw_extraction: extraction.raw_extraction,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        throw new Error(insertError?.message ?? "Could not save document record");
      }

      const status =
        extraction.confidence === "review" ||
        extraction.confidence === "do_not_deduct" ||
        extraction.gross_amount == null
          ? "needs_review"
          : "done";

      await supabase.from("uploaded_files").update({ processing_status: status }).eq("id", file.id);

      processed += 1;
      if (status === "needs_review") needsReview += 1;

      outcomes.push({
        filename: file.original_filename,
        counterparty: extraction.counterparty_name,
        grossAmount: extraction.gross_amount,
        vatAmount: extraction.vat_amount,
        invoiceNumber: extraction.invoice_number,
        matchedBank: false,
        confidence: extraction.confidence,
        status: "extracted",
        error: extraction.warning ?? undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      failures.push(`${file.original_filename}: ${message}`);
      await supabase
        .from("uploaded_files")
        .update({ processing_status: "failed", error_message: message })
        .eq("id", file.id);
      needsReview += 1;
      outcomes.push({
        ...baseOutcome,
        status: "failed",
        error: message,
      });
    }
  }

  return { processed, needsReview, skipped, outcomes, failures };
}

export async function reconcileSession(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  filingPeriodId: string,
): Promise<number> {
  await supabase
    .from("bank_transactions")
    .update({ matched_document_id: null, reconciliation_status: "unmatched" })
    .eq("session_id", sessionId)
    .eq("reconciliation_status", "matched");

  const [{ data: documents }, { data: transactions }, { data: files }] = await Promise.all([
    supabase
      .from("document_records")
      .select(
        "id, gross_amount, vat_amount, invoice_date, payment_date, counterparty_name, file_id",
      )
      .eq("filing_period_id", filingPeriodId),
    supabase
      .from("bank_transactions")
      .select(
        "id, amount, transaction_date, description, counterparty, reconciliation_status, matched_document_id",
      )
      .eq("session_id", sessionId)
      .eq("reconciliation_status", "unmatched"),
    supabase.from("uploaded_files").select("id, original_filename").eq("session_id", sessionId),
  ]);

  if (!documents?.length || !transactions?.length) return 0;

  const filenameByFileId = new Map(
    (files ?? []).map((f) => [f.id, f.original_filename] as const),
  );

  let matched = 0;

  for (const doc of documents) {
    if (doc.gross_amount == null && doc.vat_amount == null) continue;

    const filename = filenameByFileId.get(doc.file_id) ?? "";
    let best: (typeof transactions)[number] | null = null;
    let bestScore = 0;

    for (const tx of transactions) {
      if (tx.matched_document_id) continue;
      const score = scoreDocumentBankMatch(doc, tx, filename);
      if (score > bestScore) {
        bestScore = score;
        best = tx;
      }
    }

    if (!best || bestScore < 10) continue;

    await supabase
      .from("bank_transactions")
      .update({ matched_document_id: doc.id, reconciliation_status: "matched" })
      .eq("id", best.id);

    best.matched_document_id = doc.id;
    matched += 1;
  }

  return matched;
}

export async function runFilingProcess(filingPeriodId: string): Promise<ProcessResult> {
  const supabase = createSupabaseAdmin();

  const { data: filing, error: filingError } = await supabase
    .from("filing_periods")
    .select("period_start, period_end")
    .eq("id", filingPeriodId)
    .maybeSingle();

  if (filingError || !filing?.period_start || !filing?.period_end) {
    throw new Error("Filing period not found.");
  }

  const { data: session, error: sessionError } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionError || !session) {
    throw new Error("No upload session found. Upload documents and bank files first.");
  }

  const { data: files, error: filesError } = await supabase
    .from("uploaded_files")
    .select("id, kind, storage_bucket, storage_path, original_filename, mime_type, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false });

  if (filesError || !files?.length) {
    throw new Error("No uploaded files found for this filing.");
  }

  const documentFiles = dedupeFilesByName(
    files.filter((f) => f.kind === "document") as UploadedFileRow[],
  );
  const bankFiles = files.filter((f) => f.kind === "bank") as UploadedFileRow[];

  if (documentFiles.length === 0 || bankFiles.length === 0) {
    throw new Error("Upload both documents and bank files before continuing.");
  }

  await supabase.from("upload_sessions").update({ status: "processing" }).eq("id", session.id);

  await clearPreviousResults(supabase, session.id, filingPeriodId);

  await logAppEvent("info", "process", "Processing started", {
    filingPeriodId,
    sessionId: session.id,
    documents: documentFiles.length,
    bankFiles: bankFiles.length,
  });

  const bankTransactions = await processBankFiles(
    supabase,
    session.id,
    bankFiles,
    filing.period_start,
    filing.period_end,
  );
  assertOpenAiConfigured();
  const { processed: documentsProcessed, needsReview, skipped } = await processDocumentFiles(
    supabase,
    filingPeriodId,
    documentFiles,
    filing.period_start,
    filing.period_end,
  );
  const matched = await reconcileSession(supabase, session.id, filingPeriodId);

  try {
    const { buildElsterExport } = await import("@/lib/vat/export-elster");
    await buildElsterExport(filingPeriodId);
  } catch {
    // export preview optional if no documents yet
  }

  const sessionStatus = needsReview > 0 ? "needs_review" : "done";
  await supabase.from("upload_sessions").update({ status: sessionStatus }).eq("id", session.id);

  await logAppEvent("info", "process", "Processing finished", {
    filingPeriodId,
    sessionId: session.id,
    documentsProcessed,
    bankTransactions,
    matched,
    needsReview,
    skipped,
  });

  return {
    sessionId: session.id,
    documentsProcessed,
    bankTransactions,
    matched,
    needsReview,
  };
}

function applyBankMatchFlags(
  outcomes: ProcessedDocumentSummary[],
  matchedByFilename: Map<string, boolean>,
): ProcessedDocumentSummary[] {
  return outcomes.map((outcome) => ({
    ...outcome,
    matchedBank: matchedByFilename.get(outcome.filename.toLowerCase()) ?? outcome.matchedBank,
  }));
}

async function refreshOutcomesFromRecords(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  filingPeriodId: string,
  fileIds: string[],
  outcomes: ProcessedDocumentSummary[],
  matchFlags: Map<string, boolean>,
): Promise<ProcessedDocumentSummary[]> {
  if (fileIds.length === 0) return outcomes;

  const { data: records } = await supabase
    .from("document_records")
    .select(
      "file_id, counterparty_name, gross_amount, vat_amount, invoice_number, confidence, warning",
    )
    .eq("filing_period_id", filingPeriodId)
    .in("file_id", fileIds);

  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id, original_filename")
    .in("id", fileIds);

  const recordByFileId = new Map((records ?? []).map((row) => [row.file_id, row] as const));
  const fileIdByName = new Map(
    (files ?? []).map((f) => [f.original_filename.toLowerCase(), f.id] as const),
  );

  return outcomes.map((outcome) => {
    const fileId = fileIdByName.get(outcome.filename.toLowerCase());
    const row = fileId ? recordByFileId.get(fileId) : undefined;
    if (!row) {
      return {
        ...outcome,
        matchedBank: matchFlags.get(outcome.filename.toLowerCase()) ?? outcome.matchedBank,
      };
    }

    return {
      filename: outcome.filename,
      counterparty: row.counterparty_name,
      grossAmount: row.gross_amount != null ? Number(row.gross_amount) : null,
      vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
      invoiceNumber: row.invoice_number,
      matchedBank: matchFlags.get(outcome.filename.toLowerCase()) ?? false,
      confidence: row.confidence ?? outcome.confidence,
      status: outcome.status,
      error: row.warning ?? outcome.error,
    };
  });
}

async function bankMatchFlagsForFiles(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  fileIds: string[],
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();
  if (fileIds.length === 0) return flags;

  const [{ data: records }, { data: files }, { data: matchedTx }] = await Promise.all([
    supabase
      .from("document_records")
      .select("id, file_id")
      .in("file_id", fileIds),
    supabase.from("uploaded_files").select("id, original_filename").in("id", fileIds),
    supabase
      .from("bank_transactions")
      .select("matched_document_id")
      .eq("session_id", sessionId)
      .not("matched_document_id", "is", null),
  ]);

  const filenameById = new Map((files ?? []).map((f) => [f.id, f.original_filename] as const));
  const matchedDocIds = new Set(
    (matchedTx ?? []).map((row) => row.matched_document_id).filter(Boolean),
  );

  for (const row of records ?? []) {
    const name = filenameById.get(row.file_id);
    if (name) {
      flags.set(name.toLowerCase(), matchedDocIds.has(row.id));
    }
  }

  return flags;
}

/** Process only newly uploaded documents (e.g. from chat). Does not wipe existing records. */
export async function runIncrementalDocumentProcess(
  filingPeriodId: string,
  fileIds?: string[],
): Promise<ProcessResult> {
  const supabase = createSupabaseAdmin();

  const { data: filing } = await supabase
    .from("filing_periods")
    .select("period_start, period_end")
    .eq("id", filingPeriodId)
    .maybeSingle();

  if (!filing?.period_start || !filing?.period_end) {
    throw new Error("Filing period not found.");
  }

  const { data: session } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) throw new Error("No upload session.");

  const filesToProcess = await resolveDocumentFilesToProcess(
    supabase,
    session.id,
    filingPeriodId,
    fileIds,
  );

  if (filesToProcess.length === 0) {
    const matched = await reconcileSession(supabase, session.id, filingPeriodId);
    return {
      sessionId: session.id,
      documentsProcessed: 0,
      bankTransactions: 0,
      matched,
      needsReview: 0,
      recentDocuments: [],
      failures: fileIds?.length
        ? ["Files were uploaded but nothing was queued for extraction — try again."]
        : [],
    };
  }

  assertOpenAiConfigured();

  if (fileIds?.length) {
    const ids = filesToProcess.map((f) => f.id);
    await supabase
      .from("document_records")
      .delete()
      .eq("filing_period_id", filingPeriodId)
      .in("file_id", ids);
    await supabase
      .from("uploaded_files")
      .update({ processing_status: "pending", error_message: null })
      .in("id", ids);
  }

  await supersedeDuplicateFilenameRecords(supabase, filingPeriodId, session.id, filesToProcess);

  const {
    processed: documentsProcessed,
    needsReview,
    skipped,
    outcomes,
    failures,
  } = await processDocumentFiles(
    supabase,
    filingPeriodId,
    filesToProcess,
    filing.period_start,
    filing.period_end,
  );

  const batchFileIds = filesToProcess.map((f) => f.id);

  const { repaired, bankFilled } = await repairBrokenSupplierRecords(
    filingPeriodId,
    session.id,
    batchFileIds,
  );

  const { applied: elsterApplied } = await autoApplyUploadedDocumentsToElster(
    filingPeriodId,
    batchFileIds,
  );
  const matched = await reconcileSession(supabase, session.id, filingPeriodId);
  const matchFlags = await bankMatchFlagsForFiles(supabase, session.id, batchFileIds);
  let recentDocuments = applyBankMatchFlags(outcomes, matchFlags);
  recentDocuments = await refreshOutcomesFromRecords(
    supabase,
    filingPeriodId,
    filesToProcess.map((f) => f.id),
    recentDocuments,
    matchFlags,
  );

  if (documentsProcessed === 0 && failures.length === 0 && skipped === filesToProcess.length) {
    failures.push("All uploaded files were skipped — check file types (PDF/images only).");
  }

  if (documentsProcessed === 0 && failures.length > 0) {
    throw new Error(failures.join(" "));
  }

  let vatPayable: number | undefined;
  let inputVatDeductible: number | undefined;
  let includedDocuments: number | undefined;
  let excludedDocuments: number | undefined;
  let exportReady: boolean | undefined;

  try {
    const { buildElsterExport } = await import("@/lib/vat/export-elster");
    const pkg = await buildElsterExport(filingPeriodId);
    if (pkg) {
      vatPayable = pkg.rollup.vatPayable;
      inputVatDeductible = pkg.rollup.inputVatDeductible;
      includedDocuments = pkg.rollup.includedDocuments;
      excludedDocuments = pkg.rollup.excludedDocuments;
      exportReady = pkg.exportReady;
    }
  } catch {
    // optional
  }

  await logAppEvent("info", "process", "Incremental document process finished", {
    filingPeriodId,
    sessionId: session.id,
    documentsProcessed,
    matched,
    needsReview,
    skipped,
    failureCount: failures.length,
    elsterApplied,
    repaired,
    bankFilled,
    vatPayable,
    fileIds: batchFileIds,
  });

  return {
    sessionId: session.id,
    documentsProcessed,
    bankTransactions: 0,
    matched,
    needsReview,
    recentDocuments,
    failures,
    vatPayable,
    inputVatDeductible,
    elsterApplied,
    includedDocuments,
    excludedDocuments,
    exportReady,
    repaired,
    bankFilled,
  };
}

/** Re-import bank CSV after chat upload. Replaces session bank lines, keeps documents. */
export async function runIncrementalBankReimport(filingPeriodId: string): Promise<ProcessResult> {
  const supabase = createSupabaseAdmin();

  const { data: filing } = await supabase
    .from("filing_periods")
    .select("period_start, period_end")
    .eq("id", filingPeriodId)
    .maybeSingle();

  if (!filing?.period_start || !filing?.period_end) {
    throw new Error("Filing period not found.");
  }

  const { data: session } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) throw new Error("No upload session.");

  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id, kind, storage_bucket, storage_path, original_filename, mime_type, created_at")
    .eq("session_id", session.id)
    .eq("kind", "bank")
    .order("created_at", { ascending: false });

  const bankFiles = (files ?? []) as UploadedFileRow[];
  if (bankFiles.length === 0) {
    throw new Error("No bank files in session.");
  }

  await supabase.from("bank_transactions").delete().eq("session_id", session.id);

  const bankTransactions = await processBankFiles(
    supabase,
    session.id,
    bankFiles,
    filing.period_start,
    filing.period_end,
  );

  const matched = await reconcileSession(supabase, session.id, filingPeriodId);

  try {
    const { buildElsterExport } = await import("@/lib/vat/export-elster");
    await buildElsterExport(filingPeriodId);
  } catch {
    // optional
  }

  return {
    sessionId: session.id,
    documentsProcessed: 0,
    bankTransactions,
    matched,
    needsReview: 0,
  };
}
