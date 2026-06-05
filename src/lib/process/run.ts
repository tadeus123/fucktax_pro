import { logAppEvent } from "@/lib/app-events";
import { dedupeBankRows, parseBankCsv } from "@/lib/process/bank-csv";
import { extractDocument } from "@/lib/process/documents";
import type { ProcessResult } from "@/lib/process/types";
import { createSupabaseAdmin } from "@/lib/supabase/server";

type UploadedFileRow = {
  id: string;
  kind: "document" | "bank";
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
};

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs(da.getTime() - db.getTime()) / 86400000;
}

async function clearPreviousResults(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  fileIds: string[],
) {
  if (fileIds.length > 0) {
    await supabase.from("document_records").delete().in("file_id", fileIds);
  }
  await supabase.from("bank_transactions").delete().eq("session_id", sessionId);
  await supabase.from("vat_summaries").delete().eq("session_id", sessionId);
}

async function processBankFiles(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  bankFiles: UploadedFileRow[],
): Promise<number> {
  const allRows = [];

  for (const file of bankFiles) {
    const lower = file.original_filename.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".txt")) continue;

    const { data: blob, error } = await supabase.storage
      .from(file.storage_bucket)
      .download(file.storage_path);

    if (error || !blob) continue;

    const buffer = Buffer.from(await blob.arrayBuffer());
    allRows.push(...parseBankCsv(buffer));
  }

  const unique = dedupeBankRows(allRows);
  if (unique.length === 0) return 0;

  const primaryCsv = bankFiles.find((f) => f.original_filename.toLowerCase().endsWith(".csv"));
  const sourceFileId = primaryCsv?.id ?? bankFiles[0]?.id ?? null;

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
): Promise<{ processed: number; needsReview: number }> {
  let processed = 0;
  let needsReview = 0;

  for (const file of documentFiles) {
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
      const extraction = await extractDocument(file.original_filename, file.mime_type, buffer);

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
        raw_extraction: extraction.raw_extraction,
      });

      if (insertError) throw new Error(insertError.message);

      const status =
        extraction.confidence === "review" || extraction.confidence === "do_not_deduct"
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

  return { processed, needsReview };
}

async function reconcileSession(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  filingPeriodId: string,
): Promise<number> {
  const [{ data: documents }, { data: transactions }] = await Promise.all([
    supabase
      .from("document_records")
      .select("id, gross_amount, invoice_date, payment_date")
      .eq("filing_period_id", filingPeriodId),
    supabase
      .from("bank_transactions")
      .select("id, amount, transaction_date, reconciliation_status, matched_document_id")
      .eq("session_id", sessionId)
      .eq("reconciliation_status", "unmatched"),
  ]);

  if (!documents?.length || !transactions?.length) return 0;

  let matched = 0;

  for (const doc of documents) {
    if (doc.gross_amount == null) continue;
    const targetAmount = -Math.abs(Number(doc.gross_amount));
    const docDate = doc.payment_date ?? doc.invoice_date;

    const candidate = transactions.find((tx) => {
      if (tx.matched_document_id) return false;
      if (Math.abs(Number(tx.amount) - targetAmount) > 0.05) return false;
      if (docDate && daysBetween(String(docDate), tx.transaction_date) > 21) return false;
      return true;
    });

    if (!candidate) continue;

    await supabase
      .from("bank_transactions")
      .update({ matched_document_id: doc.id, reconciliation_status: "matched" })
      .eq("id", candidate.id);

    candidate.matched_document_id = doc.id;
    matched += 1;
  }

  return matched;
}

export async function runFilingProcess(filingPeriodId: string): Promise<ProcessResult> {
  const supabase = createSupabaseAdmin();

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
    .select("id, kind, storage_bucket, storage_path, original_filename, mime_type")
    .eq("session_id", session.id);

  if (filesError || !files?.length) {
    throw new Error("No uploaded files found for this filing.");
  }

  const documentFiles = files.filter((f) => f.kind === "document") as UploadedFileRow[];
  const bankFiles = files.filter((f) => f.kind === "bank") as UploadedFileRow[];

  if (documentFiles.length === 0 || bankFiles.length === 0) {
    throw new Error("Upload both documents and bank files before continuing.");
  }

  await supabase.from("upload_sessions").update({ status: "processing" }).eq("id", session.id);

  await clearPreviousResults(
    supabase,
    session.id,
    documentFiles.map((f) => f.id),
  );

  await logAppEvent("info", "process", "Processing started", {
    filingPeriodId,
    sessionId: session.id,
    documents: documentFiles.length,
    bankFiles: bankFiles.length,
  });

  const bankTransactions = await processBankFiles(supabase, session.id, bankFiles);
  const { processed: documentsProcessed, needsReview } = await processDocumentFiles(
    supabase,
    filingPeriodId,
    documentFiles,
  );
  const matched = await reconcileSession(supabase, session.id, filingPeriodId);

  const sessionStatus = needsReview > 0 ? "needs_review" : "done";
  await supabase.from("upload_sessions").update({ status: sessionStatus }).eq("id", session.id);

  await logAppEvent("info", "process", "Processing finished", {
    filingPeriodId,
    sessionId: session.id,
    documentsProcessed,
    bankTransactions,
    matched,
    needsReview,
  });

  return {
    sessionId: session.id,
    documentsProcessed,
    bankTransactions,
    matched,
    needsReview,
  };
}
