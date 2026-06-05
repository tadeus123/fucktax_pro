import type { VatCaseId } from "@/lib/vat/cases";
import { roundEuro } from "@/lib/vat/elster-fields";
import { inferSupplierFromFilename, matchesVendorPattern } from "@/lib/vat/vendor-match";
import { createSupabaseAdmin } from "@/lib/supabase/server";

const SUPPLIER_CASES: VatCaseId[] = [
  "de_supplier_19",
  "de_supplier_7",
  "eu_b2b_supplier_rc",
  "non_eu_service_rc",
];

function inferVatCase(
  filename: string,
  counterparty: string | null,
  documentType: string | null,
  currentCase: string | null,
): VatCaseId | null {
  if (currentCase && SUPPLIER_CASES.includes(currentCase as VatCaseId)) {
    return currentCase as VatCaseId;
  }

  const hay = `${filename} ${counterparty ?? ""}`.toLowerCase();
  if (matchesVendorPattern(hay, "tokenize") || inferSupplierFromFilename(filename)) {
    return "de_supplier_19";
  }

  if (documentType === "supplier_invoice" || documentType === "receipt") {
    return "de_supplier_19";
  }

  return null;
}

function fillAmounts(
  gross: number | null,
  net: number | null,
  vat: number | null,
  rate: number | null,
  vatCase: VatCaseId,
): { gross: number | null; net: number; vat: number; rate: number } {
  const defaultRate = vatCase === "de_supplier_7" ? 7 : 19;
  const r = rate != null && rate > 0 ? rate : defaultRate;

  if (gross != null && gross > 0) {
    if (vat != null && vat > 0 && net != null && net > 0) {
      return { gross, net: roundEuro(net), vat: roundEuro(vat), rate: r };
    }
    const derivedNet = roundEuro(gross / (1 + r / 100));
    const derivedVat = roundEuro(gross - derivedNet);
    return { gross, net: derivedNet, vat: derivedVat, rate: r };
  }

  if (net != null && net > 0) {
    const derivedVat = vat != null && vat > 0 ? roundEuro(vat) : roundEuro((net * r) / 100);
    return {
      gross: roundEuro(net + derivedVat),
      net: roundEuro(net),
      vat: derivedVat,
      rate: r,
    };
  }

  if (vat != null && vat > 0) {
    const derivedNet = roundEuro(vat / (r / 100));
    return { gross: roundEuro(derivedNet + vat), net: derivedNet, vat: roundEuro(vat), rate: r };
  }

  return { gross, net: 0, vat: 0, rate: r };
}

/** After chat upload: mark extracted supplier invoices for ELSTER rollup with amounts. */
export async function autoApplyUploadedDocumentsToElster(
  filingPeriodId: string,
  fileIds: string[],
): Promise<{ applied: number; inputVatAdded: number }> {
  if (fileIds.length === 0) return { applied: 0, inputVatAdded: 0 };

  const supabase = createSupabaseAdmin();

  const { data: records } = await supabase
    .from("document_records")
    .select(
      "id, file_id, counterparty_name, document_type, risk_status, confidence, gross_amount, net_amount, vat_amount, vat_rate",
    )
    .eq("filing_period_id", filingPeriodId)
    .in("file_id", fileIds);

  if (!records?.length) return { applied: 0, inputVatAdded: 0 };

  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id, original_filename")
    .in("id", fileIds);

  const filenameById = new Map((files ?? []).map((f) => [f.id, f.original_filename] as const));

  let applied = 0;
  let inputVatAdded = 0;

  for (const row of records) {
    if (row.confidence === "do_not_deduct") continue;

    const filename = filenameById.get(row.file_id) ?? "";
    const vatCase = inferVatCase(
      filename,
      row.counterparty_name,
      row.document_type,
      row.risk_status,
    );
    if (!vatCase) continue;

    const gross = row.gross_amount != null ? Number(row.gross_amount) : null;
    const net = row.net_amount != null ? Number(row.net_amount) : null;
    const vat = row.vat_amount != null ? Number(row.vat_amount) : null;
    const rate = row.vat_rate != null ? Number(row.vat_rate) : null;

    const filled = fillAmounts(gross, net, vat, rate, vatCase);
    if (filled.vat <= 0 && filled.net <= 0) continue;

    const { error } = await supabase
      .from("document_records")
      .update({
        risk_status: vatCase,
        confidence: "likely",
        gross_amount: filled.gross,
        net_amount: filled.net,
        vat_amount: filled.vat,
        vat_rate: filled.rate,
        warning: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (error) continue;

    applied += 1;
    inputVatAdded += filled.vat;
  }

  return { applied, inputVatAdded: roundEuro(inputVatAdded) };
}
