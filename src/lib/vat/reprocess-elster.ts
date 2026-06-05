import type { ProcessedDocumentSummary } from "@/lib/process/types";
import { autoApplyUploadedDocumentsToElster } from "@/lib/vat/auto-file-documents";
import { buildElsterExport } from "@/lib/vat/export-elster";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export type ElsterReprocessResult = {
  elsterApplied: number;
  inputVatAdded: number;
  matched: number;
  vatPayable: number | null;
  inputVatDeductible: number | null;
  includedDocuments: number | null;
  excludedDocuments: number | null;
  recentDocuments: ProcessedDocumentSummary[];
};

/** Reconcile type imported lazily to keep module graph simple. */
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

export function formatElsterReprocessReply(result: ElsterReprocessResult): string {
  const docs = result.recentDocuments.filter((d) => d.status === "extracted");
  const lines =
    docs.length > 0
      ? docs.map((d) => {
          const amounts = [
            d.grossAmount != null ? `gross €${d.grossAmount.toFixed(2)}` : null,
            d.vatAmount != null ? `VAT €${d.vatAmount.toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          const bank = d.matchedBank ? "bank matched" : "not bank-matched";
          return `${d.filename}: ${d.counterparty ?? "unknown"}${amounts ? ` (${amounts})` : ""} — ${bank}`;
        })
      : ["No supplier invoices in backend yet — upload PDFs with + then Send."];

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

  return [
    "ELSTER rebuilt from backend (no AI guesswork):",
    ...lines,
    "",
    ...stats,
    result.elsterApplied > 0
      ? `${result.elsterApplied} invoice(s) filed as de_supplier in ELSTER.`
      : "No new invoices auto-filed — check extraction amounts on uploaded PDFs.",
    `Bank matches this run: ${result.matched}. Download ELSTER XML to verify Kz66/Kz98.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function shouldRunBackendElsterRefresh(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return (
    /\belster\b|\bxml\b|voranmeldung|ustva|mein elster/i.test(text) ||
    /\bcalculate\b.*\bvat\b|\bnew vat\b|\brecalculate\b|\bupdate.*xml\b|\bvorsteuer\b|\brollup\b/i.test(
      text,
    )
  );
}

/** Auto-file supplier invoices, reconcile bank, rebuild ELSTER rollup. */
export async function reprocessFilingElster(
  filingPeriodId: string,
  reconcileSession: ReconcileFn,
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
      vatPayable: null,
      inputVatDeductible: null,
      includedDocuments: null,
      excludedDocuments: null,
      recentDocuments: [],
    };
  }

  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id")
    .eq("session_id", session.id)
    .eq("kind", "document");

  const fileIds = (files ?? []).map((f) => f.id);

  const { applied: elsterApplied, inputVatAdded } = await autoApplyUploadedDocumentsToElster(
    filingPeriodId,
    fileIds,
  );
  const matched = await reconcileSession(supabase, session.id, filingPeriodId);
  const recentDocuments = await loadDocumentSummaries(
    supabase,
    filingPeriodId,
    session.id,
    fileIds,
  );

  let vatPayable: number | null = null;
  let inputVatDeductible: number | null = null;
  let includedDocuments: number | null = null;
  let excludedDocuments: number | null = null;

  const refreshed = await buildElsterExport(filingPeriodId);
  if (refreshed) {
    vatPayable = refreshed.rollup.vatPayable;
    inputVatDeductible = refreshed.rollup.inputVatDeductible;
    includedDocuments = refreshed.rollup.includedDocuments;
    excludedDocuments = refreshed.rollup.excludedDocuments;
  }

  return {
    elsterApplied,
    inputVatAdded,
    matched,
    vatPayable,
    inputVatDeductible,
    includedDocuments,
    excludedDocuments,
    recentDocuments,
  };
}
