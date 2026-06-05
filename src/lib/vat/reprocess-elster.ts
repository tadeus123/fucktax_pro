import type { ProcessedDocumentSummary } from "@/lib/process/types";
import { getElsterExportStatus, formatElsterBlockersForChat } from "@/lib/vat/elster-export-status";
import { autoApplyUploadedDocumentsToElster } from "@/lib/vat/auto-file-documents";
import { buildElsterExport } from "@/lib/vat/export-elster";
import {
  pickDocumentsForReply,
  repairBrokenSupplierRecords,
  tokenizeFileIdsInSession,
} from "@/lib/vat/repair-supplier-records";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export type ElsterReprocessResult = {
  elsterApplied: number;
  inputVatAdded: number;
  matched: number;
  repaired: number;
  bankFilled: number;
  vatPayable: number | null;
  inputVatDeductible: number | null;
  includedDocuments: number | null;
  excludedDocuments: number | null;
  exportReady: boolean;
  recentDocuments: ProcessedDocumentSummary[];
};

type ReconcileFn = (
  supabase: ReturnType<typeof createSupabaseAdmin>,
  sessionId: string,
  filingPeriodId: string,
) => Promise<number>;

async function loadDocumentSummaries(
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
        "id, file_id, counterparty_name, gross_amount, vat_amount, invoice_number, confidence, warning",
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

  return (records ?? []).map((row) => {
    const filename = filenameById.get(row.file_id) ?? "unknown";
    return {
      filename,
      counterparty: row.counterparty_name,
      grossAmount: row.gross_amount != null ? Number(row.gross_amount) : null,
      vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
      invoiceNumber: row.invoice_number,
      matchedBank: matchedDocIds.has(row.id),
      confidence: row.confidence ?? "review",
      status: "extracted" as const,
      error: row.warning ?? undefined,
    };
  });
}

function formatDocLine(d: ProcessedDocumentSummary): string {
  const amounts = [
    d.grossAmount != null ? `gross €${d.grossAmount.toFixed(2)}` : null,
    d.vatAmount != null ? `VAT €${d.vatAmount.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const bank = d.matchedBank ? "bank matched" : "not bank-matched";
  const missing = !amounts ? " — **missing amounts, re-upload PDF**" : "";
  return `${d.filename}: ${d.counterparty ?? "unknown"}${amounts ? ` (${amounts})` : ""} — ${bank}${missing}`;
}

export function formatElsterReprocessReply(
  result: ElsterReprocessResult,
  userMessage?: string,
): string {
  const docs = pickDocumentsForReply(
    result.recentDocuments.filter((d) => d.status === "extracted"),
    userMessage,
    12,
  );

  const lines =
    docs.length > 0
      ? docs.map(formatDocLine)
      : ["No matching invoices in backend — upload PDFs with + then Send."];

  const stats: string[] = [];
  if (result.vatPayable != null) {
    const inputVat = result.inputVatDeductible ?? 0;
    stats.push(
      result.vatPayable <= 0 && inputVat > 0
        ? `VAT payable €${result.vatPayable.toFixed(2)} (Vorsteuer €${inputVat.toFixed(2)} in rollup).`
        : `VAT payable €${result.vatPayable.toFixed(2)} (input Vorsteuer €${inputVat.toFixed(2)}).`,
    );
  }
  if (result.includedDocuments != null) {
    stats.push(`Included in ELSTER rollup: ${result.includedDocuments}.`);
  }
  if (result.excludedDocuments != null) {
    stats.push(`Excluded from rollup: ${result.excludedDocuments}.`);
  }

  const body = [
    "Backend update (deterministic — not AI):",
    ...lines,
    "",
    ...stats,
    result.repaired > 0
      ? `Repaired ${result.repaired} record(s)${result.bankFilled > 0 ? ` (${result.bankFilled} amount(s) from bank lines)` : ""}.`
      : "",
    result.elsterApplied > 0
      ? `${result.elsterApplied} invoice(s) filed as de_supplier_19 in ELSTER.`
      : "",
    `Bank matches this run: ${result.matched}.`,
    result.exportReady
      ? "ELSTER XML ready — use Download ELSTER XML above."
      : "ELSTER XML not ready yet — see blockers below.",
  ]
    .filter(Boolean)
    .join("\n");

  return body;
}

export async function formatElsterReprocessReplyWithStatus(
  result: ElsterReprocessResult,
  filingPeriodId: string,
  userMessage?: string,
): Promise<string> {
  let reply = formatElsterReprocessReply(result, userMessage);
  if (!result.exportReady) {
    const status = await getElsterExportStatus(filingPeriodId);
    reply += formatElsterBlockersForChat(status);
  }
  return reply;
}

export function shouldRunBackendElsterRefresh(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;

  if (/\belster\b|\bxml\b|voranmeldung|ustva|mein elster/i.test(text)) return true;
  if (/\bcalculate\b.*\bvat\b|\bnew vat\b|\brecalculate\b|\bupdate.*xml\b|\bvorsteuer\b|\brollup\b/i.test(text)) {
    return true;
  }
  if (/tokenize|to25\d|include.*tokenize|here is the tokenize|these are the tokenize/i.test(text)) {
    return true;
  }
  if (/match them|check again|should also change|vat payable should|process and update elster/i.test(text)) {
    return true;
  }
  if (/^wrong$|not bank-matched|not bank matched/i.test(text)) return true;

  return false;
}

export async function reprocessFilingElster(
  filingPeriodId: string,
  reconcileSession: ReconcileFn,
  options?: { userMessage?: string; focusFileIds?: string[] },
): Promise<ElsterReprocessResult> {
  const supabase = createSupabaseAdmin();

  const { data: session } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return {
      elsterApplied: 0,
      inputVatAdded: 0,
      matched: 0,
      repaired: 0,
      bankFilled: 0,
      vatPayable: null,
      inputVatDeductible: null,
      includedDocuments: null,
      excludedDocuments: null,
      exportReady: false,
      recentDocuments: [],
    };
  }

  const tokenizeIds = await tokenizeFileIdsInSession(session.id);
  const repairIds = options?.focusFileIds?.length
    ? [...new Set([...options.focusFileIds, ...tokenizeIds])]
    : tokenizeIds.length > 0
      ? tokenizeIds
      : undefined;

  const { repaired, bankFilled } = await repairBrokenSupplierRecords(
    filingPeriodId,
    session.id,
    repairIds,
  );

  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id")
    .eq("session_id", session.id)
    .eq("kind", "document");

  const allFileIds = (files ?? []).map((f) => f.id);
  const applyIds =
    tokenizeIds.length > 0 ? [...new Set([...tokenizeIds, ...(options?.focusFileIds ?? [])])] : allFileIds;

  const { applied: elsterApplied } = await autoApplyUploadedDocumentsToElster(
    filingPeriodId,
    applyIds,
  );
  const matched = await reconcileSession(supabase, session.id, filingPeriodId);

  const displayIds =
    (options?.focusFileIds?.length ?? 0) > 0
      ? [...new Set([...(options?.focusFileIds ?? []), ...tokenizeIds])]
      : tokenizeIds.length > 0
        ? tokenizeIds
        : applyIds.slice(0, 20);

  const recentDocuments = await loadDocumentSummaries(
    supabase,
    filingPeriodId,
    session.id,
    displayIds.length > 0 ? displayIds : applyIds.slice(0, 20),
  );

  let vatPayable: number | null = null;
  let inputVatDeductible: number | null = null;
  let includedDocuments: number | null = null;
  let excludedDocuments: number | null = null;
  let exportReady = false;

  const refreshed = await buildElsterExport(filingPeriodId);
  if (refreshed) {
    vatPayable = refreshed.rollup.vatPayable;
    inputVatDeductible = refreshed.rollup.inputVatDeductible;
    includedDocuments = refreshed.rollup.includedDocuments;
    excludedDocuments = refreshed.rollup.excludedDocuments;
    exportReady = refreshed.exportReady;
  }

  return {
    elsterApplied,
    inputVatAdded: 0,
    matched,
    repaired,
    bankFilled,
    vatPayable,
    inputVatDeductible,
    includedDocuments,
    excludedDocuments,
    exportReady,
    recentDocuments,
  };
}

export function formatUploadProcessReply(
  processResult: {
    recentDocuments?: ProcessedDocumentSummary[];
    matched?: number;
    vatPayable?: number;
    inputVatDeductible?: number;
    elsterApplied?: number;
    includedDocuments?: number;
    excludedDocuments?: number;
    exportReady?: boolean;
    repaired?: number;
    bankFilled?: number;
  },
  fileNames: string[],
): string {
  const extracted = (processResult.recentDocuments ?? []).filter((d) => d.status === "extracted");
  const lines = extracted.length > 0 ? extracted.map(formatDocLine) : fileNames.map((f) => `${f}: processing failed or skipped`);

  const stats: string[] = [];
  if (processResult.vatPayable != null) {
    const inputVat = processResult.inputVatDeductible ?? 0;
    const payable = processResult.vatPayable;
    stats.push(
      payable <= 0 && inputVat > 0
        ? `VAT payable €${payable.toFixed(2)} (Vorsteuer €${inputVat.toFixed(2)} deducted).`
        : `VAT payable €${payable.toFixed(2)} (input Vorsteuer €${inputVat.toFixed(2)}).`,
    );
  }
  if (processResult.includedDocuments != null) {
    stats.push(`Included in ELSTER rollup: ${processResult.includedDocuments}.`);
  }
  if (processResult.excludedDocuments != null) {
    stats.push(`Excluded from rollup: ${processResult.excludedDocuments}.`);
  }

  return [
    `Uploaded and processed ${fileNames.length} file(s):`,
    ...lines,
    "",
    ...stats,
    processResult.repaired
      ? `Repaired ${processResult.repaired} record(s)${processResult.bankFilled ? ` (${processResult.bankFilled} from bank)` : ""}.`
      : "",
    processResult.elsterApplied
      ? `${processResult.elsterApplied} invoice(s) filed as de_supplier_19.`
      : "",
    `Bank matches: ${processResult.matched ?? 0}.`,
    processResult.exportReady === false
      ? "ELSTER XML not ready — more documents need review before import."
      : "Download ELSTER XML to verify Kz66/Kz98.",
  ]
    .filter(Boolean)
    .join("\n");
}
