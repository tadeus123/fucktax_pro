import { logAppEvent } from "@/lib/app-events";
import { dedupeBankRows, parseBankCsv, type ParsedBankRow } from "@/lib/process/bank-csv";
import { extractDocument, shouldSkipDocumentFile, type DocumentExtraction } from "@/lib/process/documents";
import type { ProcessedDocumentSummary, ProcessResult } from "@/lib/process/types";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { inferSupplierFromFilename, matchesVendorPattern } from "@/lib/vat/vendor-match";

type UploadedFileRow = {
  id: string;
  kind: "document" | "bank";
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  created_at: string;
};

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

function enrichExtractionFromFilename(
  filename: string,
  extraction: DocumentExtraction,
): DocumentExtraction {
  const supplier = inferSupplierFromFilename(filename);
  if (!supplier) return extraction;

  const cp = extraction.counterparty_name ?? "";
  const cpIsCustomer = /huge production/i.test(cp);
  const cpIsSupplier =
    matchesVendorPattern(cp, supplier) || matchesVendorPattern(cp, "tokenize");

  if (cpIsSupplier) return extraction;

  if (cpIsCustomer || !cp.trim()) {
    return {
      ...extraction,
      counterparty_name: supplier,
      document_type:
        extraction.document_type === "other" ? "supplier_invoice" : extraction.document_type,
      vat_case: extraction.vat_case ?? "de_supplier_19",
      confidence:
        extraction.confidence === "do_not_deduct" && extraction.gross_amount != null
          ? "likely"
          : extraction.confidence,
    };
  }

  return extraction;
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

  const docDate = doc.payment_date ?? doc.invoice_date;
  if (docDate) {
    const days = daysBetween(String(docDate), tx.transaction_date);
    if (days <= 28) score += 3;
    else if (days > 90) score -= 4;
  }

  return score;
}

async function summarizeProcessedDocuments(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  filingPeriodId: string,
  sessionId: string,
  fileIds: string[],
): Promise<ProcessedDocumentSummary[]> {
  if (fileIds.length === 0) return [];

  const [{ data: records }, { data: files }, { data: matchedTx }] = await Promise.all([
    supabase
      .from("document_records")
      .select(
        "id, file_id, counterparty_name, gross_amount, vat_amount, invoice_number, confidence",
      )
      .eq("filing_period_id", filingPeriodId)
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

  return (records ?? []).map((row) => ({
    filename: filenameById.get(row.file_id) ?? "unknown",
    counterparty: row.counterparty_name,
    grossAmount: row.gross_amount != null ? Number(row.gross_amount) : null,
    vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
    invoiceNumber: row.invoice_number,
    matchedBank: matchedDocIds.has(row.id),
    confidence: row.confidence ?? "review",
  }));
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
): Promise<{ processed: number; needsReview: number; skipped: number }> {
  let processed = 0;
  let needsReview = 0;
  let skipped = 0;

  for (const file of documentFiles) {
    if (shouldSkipDocumentFile(file.original_filename)) {
      skipped += 1;
      await supabase
        .from("uploaded_files")
        .update({ processing_status: "done", error_message: null })
        .eq("id", file.id);
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
          .update({ processing_status: "done" })
          .eq("id", file.id);
        continue;
      }

      const { error: insertError } = await supabase.from("document_records").insert({
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
      });

      if (insertError) throw new Error(insertError.message);

      const status =
        extraction.confidence === "review" ||
        extraction.confidence === "do_not_deduct" ||
        extraction.gross_amount == null
          ? "needs_review"
          : "done";

      await supabase.from("uploaded_files").update({ processing_status: status }).eq("id", file.id);

      processed += 1;
      if (status === "needs_review") needsReview += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      await supabase
        .from("uploaded_files")
        .update({ processing_status: "failed", error_message: message })
        .eq("id", file.id);
      needsReview += 1;
    }
  }

  return { processed, needsReview, skipped };
}

async function reconcileSession(
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

/** Process only newly uploaded documents (e.g. from chat). Does not wipe existing records. */
export async function runIncrementalDocumentProcess(
  filingPeriodId: string,
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

  const [{ data: files }, { data: existingRecords }] = await Promise.all([
    supabase
      .from("uploaded_files")
      .select("id, kind, storage_bucket, storage_path, original_filename, mime_type, created_at")
      .eq("session_id", session.id)
      .eq("kind", "document")
      .order("created_at", { ascending: false }),
    supabase.from("document_records").select("file_id").eq("filing_period_id", filingPeriodId),
  ]);

  const processedFileIds = new Set((existingRecords ?? []).map((r) => r.file_id));
  const newFiles = dedupeFilesByName(
    (files ?? []).filter((f) => !processedFileIds.has(f.id)) as UploadedFileRow[],
  );

  if (newFiles.length === 0) {
    const matched = await reconcileSession(supabase, session.id, filingPeriodId);
    return {
      sessionId: session.id,
      documentsProcessed: 0,
      bankTransactions: 0,
      matched,
      needsReview: 0,
      recentDocuments: [],
    };
  }

  const { processed: documentsProcessed, needsReview, skipped } = await processDocumentFiles(
    supabase,
    filingPeriodId,
    newFiles,
    filing.period_start,
    filing.period_end,
  );
  const matched = await reconcileSession(supabase, session.id, filingPeriodId);
  const recentDocuments = await summarizeProcessedDocuments(
    supabase,
    filingPeriodId,
    session.id,
    newFiles.map((f) => f.id),
  );

  try {
    const { buildElsterExport } = await import("@/lib/vat/export-elster");
    await buildElsterExport(filingPeriodId);
  } catch {
    // optional
  }

  return {
    sessionId: session.id,
    documentsProcessed,
    bankTransactions: 0,
    matched,
    needsReview,
    recentDocuments,
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
