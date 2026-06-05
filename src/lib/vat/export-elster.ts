import {
  computeVatRollup,
  type RollupBankEntry,
  type RollupDocument,
} from "@/lib/vat/rollup";
import {
  elsterQuarterCode,
  formatElsterCsv,
  normalizeSteuernummer,
} from "@/lib/vat/elster-fields";
import {
  buildUstvaImportXml,
  encodeUstvaXml,
  validateUstvaExport,
} from "@/lib/vat/ustva-xml";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export type ElsterExportPackage = {
  filingPeriodId: string;
  filingLabel: string;
  year: string;
  elsterPeriod: string;
  steuernummer: string;
  rollup: ReturnType<typeof computeVatRollup>;
  xml: string;
  xmlBuffer: Buffer;
  csv: string;
  validationErrors: string[];
  exportReady: boolean;
};

function steuernummerFromEnv(): string {
  const raw =
    process.env.ELSTER_STEUERNUMMER?.trim() ||
    process.env.COMPANY_STEUERNUMMER?.trim() ||
    "202/110/00377";
  return normalizeSteuernummer(raw);
}

async function loadRollupDocuments(filingPeriodId: string): Promise<RollupDocument[]> {
  const supabase = createSupabaseAdmin();

  const { data: records } = await supabase
    .from("document_records")
    .select(
      "id, confidence, risk_status, document_type, net_amount, vat_rate, vat_amount, gross_amount, file_id, created_at",
    )
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false });

  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id, original_filename");

  const filenameById = new Map((files ?? []).map((f) => [f.id, f.original_filename] as const));

  const seenFiles = new Set<string>();
  const docs: RollupDocument[] = [];

  for (const row of records ?? []) {
    if (seenFiles.has(row.file_id)) continue;
    seenFiles.add(row.file_id);

    docs.push({
      id: row.id,
      filename: filenameById.get(row.file_id) ?? "unknown",
      confidence: row.confidence,
      riskStatus: row.risk_status,
      documentType: row.document_type,
      netAmount: row.net_amount != null ? Number(row.net_amount) : null,
      vatRate: row.vat_rate != null ? Number(row.vat_rate) : null,
      vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
      grossAmount: row.gross_amount != null ? Number(row.gross_amount) : null,
    });
  }

  return docs;
}

async function loadConfirmedBankEntries(sessionId: string): Promise<RollupBankEntry[]> {
  const supabase = createSupabaseAdmin();
  const { data: lines } = await supabase
    .from("bank_transactions")
    .select("id, description, counterparty, amount, treatment_case, user_confirmed")
    .eq("session_id", sessionId)
    .eq("user_confirmed", true);

  return (lines ?? [])
    .filter((line) => line.treatment_case)
    .map((line) => ({
      id: line.id,
      description: `${line.description ?? ""} ${line.counterparty ?? ""}`.trim(),
      amount: Number(line.amount),
      treatmentCase: line.treatment_case as string,
    }));
}

export async function buildElsterExport(filingPeriodId: string): Promise<ElsterExportPackage | null> {
  const supabase = createSupabaseAdmin();

  const { data: filing } = await supabase
    .from("filing_periods")
    .select("label, period_start, period_end")
    .eq("id", filingPeriodId)
    .maybeSingle();

  if (!filing?.period_start) return null;

  const { data: session } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) return null;

  const [{ data: reviewRows }, documents, bankEntries] = await Promise.all([
    supabase
      .from("document_records")
      .select("confidence, gross_amount, document_type, warning")
      .eq("filing_period_id", filingPeriodId),
    loadRollupDocuments(filingPeriodId),
    loadConfirmedBankEntries(session.id),
  ]);

  const { data: allBankLines } = await supabase
    .from("bank_transactions")
    .select("amount, reconciliation_status, user_confirmed")
    .eq("session_id", session.id);

  const rollup = computeVatRollup(documents, bankEntries);

  const year = filing.period_start.slice(0, 4);
  const elsterPeriod = elsterQuarterCode(filing.period_start);
  const steuernummer = steuernummerFromEnv();

  const meta = { year, period: elsterPeriod, steuernummer, label: filing.label };

  const validationErrors = validateUstvaExport({
    year,
    period: elsterPeriod,
    steuernummer,
    fields: rollup.elsterFields,
  });

  const needsReview = (reviewRows ?? []).filter(
    (row) =>
      row.confidence === "review" ||
      row.confidence === "do_not_deduct" ||
      row.gross_amount == null,
  ).length;
  if (needsReview > 0) {
    validationErrors.push(
      `${needsReview} document(s) still need review — resolve red flags before ELSTER import.`,
    );
  }

  const unresolvedIncome = (allBankLines ?? []).filter(
    (line) =>
      Number(line.amount) > 0 &&
      line.reconciliation_status !== "matched" &&
      !line.user_confirmed,
  ).length;
  if (unresolvedIncome > 0) {
    validationErrors.push(
      `${unresolvedIncome} incoming bank transaction(s) without invoice or chat confirmation.`,
    );
  }

  if (rollup.warnings.some((w) => w.includes("No output VAT"))) {
    validationErrors.push("Output VAT check failed — verify customer invoices before ELSTER import.");
  }

  const xml = buildUstvaImportXml(rollup.elsterFields, meta);
  const xmlBuffer = encodeUstvaXml(xml);
  const csv = formatElsterCsv(rollup.elsterFields, {
    label: filing.label,
    year,
    period: elsterPeriod,
  });

  await supabase.from("vat_summaries").upsert(
    {
      session_id: session.id,
      filing_period_id: filingPeriodId,
      output_vat_19: rollup.outputTax19,
      output_vat_7: rollup.outputTax7,
      input_vat_deductible: rollup.inputVatDeductible,
      input_vat_non_deductible: rollup.inputVatNonDeductible,
      reverse_charge_output: rollup.reverseChargeTaxEu + rollup.reverseChargeTaxNonEu,
      reverse_charge_input: rollup.reverseChargeInputVat,
      vat_payable: rollup.vatPayable,
      elster_field_map: rollup.elsterFields,
    },
    { onConflict: "session_id" },
  );

  return {
    filingPeriodId,
    filingLabel: filing.label,
    year,
    elsterPeriod,
    steuernummer,
    rollup,
    xml,
    xmlBuffer,
    csv,
    validationErrors,
    exportReady: validationErrors.length === 0,
  };
}
