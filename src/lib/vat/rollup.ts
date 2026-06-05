import type { VatCaseId } from "@/lib/vat/cases";
import {
  buildElsterFieldMap,
  roundEuro,
  type VatRollupResult,
} from "@/lib/vat/elster-fields";

export type RollupDocument = {
  id: string;
  filename: string;
  confidence: string | null;
  riskStatus: string | null;
  documentType: string | null;
  netAmount: number | null;
  vatRate: number | null;
  vatAmount: number | null;
  grossAmount: number | null;
};

export type RollupBankEntry = {
  id: string;
  description: string;
  amount: number;
  treatmentCase: string;
};

const SUPPLIER_CASES: VatCaseId[] = [
  "de_supplier_19",
  "de_supplier_7",
  "eu_b2b_supplier_rc",
  "non_eu_service_rc",
  "import_goods",
];

const OUTPUT_CASES: VatCaseId[] = ["de_customer_19", "eu_b2b_customer", "non_eu_customer"];

function resolveVatCase(doc: RollupDocument): VatCaseId | null {
  const raw = doc.riskStatus?.trim();
  if (raw && raw.length > 0) return raw as VatCaseId;
  return null;
}

function deriveAmounts(doc: RollupDocument): { net: number; vat: number; rate: number | null } {
  const rate = doc.vatRate;
  let net = doc.netAmount ?? 0;
  let vat = doc.vatAmount ?? 0;

  if (net === 0 && doc.grossAmount != null) {
    if (rate != null && rate > 0) {
      net = doc.grossAmount / (1 + rate / 100);
      vat = doc.grossAmount - net;
    } else if (vat > 0) {
      net = doc.grossAmount - vat;
    } else {
      net = doc.grossAmount;
    }
  }

  if (vat === 0 && net > 0 && rate != null && rate > 0) {
    vat = (net * rate) / 100;
  }

  return { net: roundEuro(net), vat: roundEuro(vat), rate };
}

/** Output VAT is mandatory; input VAT claimed when likely valid (saves money). */
export function shouldIncludeDocument(doc: RollupDocument): { include: boolean; reason?: string } {
  if (doc.confidence === "do_not_deduct") {
    return { include: false, reason: "marked do_not_deduct" };
  }

  const vatCase = resolveVatCase(doc);
  const { net, vat } = deriveAmounts(doc);

  if (vatCase && OUTPUT_CASES.includes(vatCase)) {
    if (net === 0 && vat === 0) {
      return { include: false, reason: "output invoice missing amounts — must fix" };
    }
    return { include: true };
  }

  if (!vatCase) {
    if (doc.documentType === "customer_invoice" || doc.documentType === "invoice_out") {
      return net > 0 || vat > 0
        ? { include: true }
        : { include: false, reason: "customer invoice missing amounts" };
    }
    if (doc.confidence === "safe" || doc.confidence === "likely") {
      return { include: true };
    }
    return { include: false, reason: "no VAT case and low confidence" };
  }

  if (vatCase === "private_mixed" || vatCase === "payment_without_invoice") {
    return { include: false, reason: vatCase };
  }

  if (vatCase === "restaurant_hospitality" && doc.confidence !== "safe") {
    return { include: false, reason: "hospitality needs documentation" };
  }

  if (SUPPLIER_CASES.includes(vatCase)) {
    if (vat > 0 || (net > 0 && (vatCase === "de_supplier_19" || vatCase === "de_supplier_7"))) {
      return { include: true };
    }
    if (doc.confidence === "safe" || doc.confidence === "likely") {
      return { include: true };
    }
    return { include: false, reason: "uncertain input VAT — skipped to avoid risk" };
  }

  if (net === 0 && vat === 0) {
    return { include: false, reason: "no amounts extracted" };
  }

  return { include: true };
}

function applyBankEntry(
  entry: RollupBankEntry,
  acc: {
    reverseChargeNetEu: number;
    reverseChargeTaxEu: number;
    reverseChargeNetNonEu: number;
    reverseChargeTaxNonEu: number;
    reverseChargeInputVat: number;
    inputVatDeductible: number;
    outputNet19: number;
    outputTax19: number;
  },
): void {
  const net = roundEuro(Math.abs(entry.amount));
  if (net === 0) return;

  switch (entry.treatmentCase) {
    case "non_eu_service_rc": {
      const tax = roundEuro(net * 0.19);
      acc.reverseChargeNetNonEu += net;
      acc.reverseChargeTaxNonEu += tax;
      acc.reverseChargeInputVat += tax;
      break;
    }
    case "eu_b2b_supplier_rc": {
      const tax = roundEuro(net * 0.19);
      acc.reverseChargeNetEu += net;
      acc.reverseChargeTaxEu += tax;
      acc.reverseChargeInputVat += tax;
      break;
    }
    case "de_supplier_19":
      acc.inputVatDeductible += roundEuro(net * 0.19);
      break;
    case "de_supplier_7":
      acc.inputVatDeductible += roundEuro(net * 0.07);
      break;
    case "de_customer_19":
      acc.outputNet19 += net;
      acc.outputTax19 += roundEuro(net * 0.19);
      break;
    default:
      break;
  }
}

export function computeVatRollup(
  documents: RollupDocument[],
  bankEntries: RollupBankEntry[] = [],
): VatRollupResult {
  const warnings: string[] = [];
  let includedDocuments = 0;
  let excludedDocuments = 0;

  let outputNet19 = 0;
  let outputTax19 = 0;
  let outputNet7 = 0;
  let outputTax7 = 0;
  let inputVatDeductible = 0;
  let inputVatNonDeductible = 0;
  let reverseChargeNetEu = 0;
  let reverseChargeTaxEu = 0;
  let reverseChargeNetNonEu = 0;
  let reverseChargeTaxNonEu = 0;
  let reverseChargeInputVat = 0;

  for (const doc of documents) {
    const decision = shouldIncludeDocument(doc);
    if (!decision.include) {
      excludedDocuments += 1;
      continue;
    }

    includedDocuments += 1;
    const vatCase = resolveVatCase(doc);
    const { net, vat, rate } = deriveAmounts(doc);

    if (!vatCase) {
      if (vat > 0 && rate === 19) inputVatDeductible += vat;
      else if (vat > 0 && rate === 7) inputVatDeductible += vat;
      else if (net > 0 && doc.documentType === "customer_invoice") outputNet19 += net;
      continue;
    }

    switch (vatCase) {
      case "de_supplier_19":
        inputVatDeductible += vat > 0 ? vat : roundEuro(net * 0.19);
        break;
      case "de_supplier_7":
        inputVatDeductible += vat > 0 ? vat : roundEuro(net * 0.07);
        break;
      case "de_customer_19":
        outputNet19 += net;
        outputTax19 += vat > 0 ? vat : roundEuro(net * 0.19);
        break;
      case "eu_b2b_supplier_rc": {
        const tax = vat > 0 ? vat : roundEuro(net * 0.19);
        reverseChargeNetEu += net;
        reverseChargeTaxEu += tax;
        reverseChargeInputVat += tax;
        break;
      }
      case "non_eu_service_rc": {
        const tax = vat > 0 ? vat : roundEuro(net * 0.19);
        reverseChargeNetNonEu += net;
        reverseChargeTaxNonEu += tax;
        reverseChargeInputVat += tax;
        break;
      }
      case "eu_b2b_customer":
        break;
      case "non_eu_customer":
        outputNet19 += net;
        break;
      case "import_goods":
        warnings.push(`Import goods (${doc.filename}) — Einfuhrumsatzsteuer needs customs doc (Kz62), not auto-filled.`);
        break;
      case "restaurant_hospitality":
        inputVatDeductible += vat > 0 ? vat * 0.7 : 0;
        warnings.push(`Restaurant (${doc.filename}) — 70% Vorsteuer rule applied; verify Bewirtungsbeleg.`);
        break;
      default:
        break;
    }
  }

  for (const bank of bankEntries) {
    if (
      bank.treatmentCase === "internal_transfer" ||
      bank.treatmentCase === "private_mixed" ||
      bank.treatmentCase === "payment_without_invoice"
    ) {
      continue;
    }
    const before = {
      reverseChargeNetEu,
      reverseChargeTaxEu,
      reverseChargeNetNonEu,
      reverseChargeTaxNonEu,
      reverseChargeInputVat,
      inputVatDeductible,
      outputNet19,
      outputTax19,
    };
    const acc = { ...before };
    applyBankEntry(bank, acc);
    reverseChargeNetEu = acc.reverseChargeNetEu;
    reverseChargeTaxEu = acc.reverseChargeTaxEu;
    reverseChargeNetNonEu = acc.reverseChargeNetNonEu;
    reverseChargeTaxNonEu = acc.reverseChargeTaxNonEu;
    reverseChargeInputVat = acc.reverseChargeInputVat;
    inputVatDeductible = acc.inputVatDeductible;
    outputNet19 = acc.outputNet19;
    outputTax19 = acc.outputTax19;
    warnings.push(
      `Bank line "${bank.description.slice(0, 40)}" included as ${bank.treatmentCase} from chat confirmation.`,
    );
  }

  const totalOutput =
    outputTax19 + outputTax7 + reverseChargeTaxEu + reverseChargeTaxNonEu;
  const totalInput = inputVatDeductible + reverseChargeInputVat;
  const vatPayable = roundEuro(totalOutput - totalInput);

  if (outputNet19 === 0 && outputTax19 === 0 && includedDocuments > 0) {
    warnings.push(
      "No output VAT (customer invoices) in filing yet — mandatory for Finanzamt. Check outgoing invoices or incoming customer payments.",
    );
  }

  const base = {
    outputNet19: roundEuro(outputNet19),
    outputTax19: roundEuro(outputTax19),
    outputNet7: roundEuro(outputNet7),
    outputTax7: roundEuro(outputTax7),
    inputVatDeductible: roundEuro(inputVatDeductible),
    inputVatNonDeductible: roundEuro(inputVatNonDeductible),
    reverseChargeNetEu: roundEuro(reverseChargeNetEu),
    reverseChargeTaxEu: roundEuro(reverseChargeTaxEu),
    reverseChargeNetNonEu: roundEuro(reverseChargeNetNonEu),
    reverseChargeTaxNonEu: roundEuro(reverseChargeTaxNonEu),
    reverseChargeInputVat: roundEuro(reverseChargeInputVat),
    vatPayable,
    includedDocuments,
    excludedDocuments,
    warnings,
  };

  return {
    ...base,
    elsterFields: buildElsterFieldMap(base),
  };
}
