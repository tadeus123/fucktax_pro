import { USTVA_2025_FIELDS } from "@/lib/vat/ustva-field-mapping";

export type ElsterFieldMap = Record<string, number>;

export function roundEuro(value: number): number {
  return Math.round(value * 100) / 100;
}

export type VatRollupResult = {
  outputNet19: number;
  outputTax19: number;
  outputNet7: number;
  outputTax7: number;
  inputVatDeductible: number;
  inputVatNonDeductible: number;
  reverseChargeNetEu: number;
  reverseChargeTaxEu: number;
  reverseChargeNetNonEu: number;
  reverseChargeTaxNonEu: number;
  reverseChargeInputVat: number;
  vatPayable: number;
  elsterFields: ElsterFieldMap;
  includedDocuments: number;
  excludedDocuments: number;
  warnings: string[];
};

export function buildElsterFieldMap(rollup: Omit<VatRollupResult, "elsterFields">): ElsterFieldMap {
  const fields: ElsterFieldMap = {};

  for (const def of USTVA_2025_FIELDS) {
    const value = rollup[def.rollupKey];
    if (value == null || value === 0) continue;
    if (def.kind === "payable" && value === 0) continue;
    fields[def.kz] = roundEuro(value);
  }

  return fields;
}

/** Q4 2025 → Zeitraum 44 (Oct–Dec). ELSTER quarterly codes 41–44. */
export function elsterQuarterCode(periodStart: string): string {
  const month = Number(periodStart.slice(5, 7));
  if (month <= 3) return "41";
  if (month <= 6) return "42";
  if (month <= 9) return "43";
  return "44";
}

export function normalizeSteuernummer(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Kennzahlen in XSD order for UStVA Nutzdaten import. */
export const ELSTER_KZ_ORDER = [
  "Kz21",
  "Kz22",
  "Kz23",
  "Kz26",
  "Kz29",
  "Kz35",
  "Kz36",
  "Kz37",
  "Kz39",
  "Kz41",
  "Kz42",
  "Kz43",
  "Kz44",
  "Kz45",
  "Kz46",
  "Kz47",
  "Kz48",
  "Kz49",
  "Kz50",
  "Kz59",
  "Kz60",
  "Kz61",
  "Kz62",
  "Kz63",
  "Kz64",
  "Kz65",
  "Kz66",
  "Kz67",
  "Kz69",
  "Kz73",
  "Kz74",
  "Kz76",
  "Kz77",
  "Kz80",
  "Kz81",
  "Kz83",
  "Kz84",
  "Kz85",
  "Kz86",
  "Kz89",
  "Kz91",
  "Kz93",
  "Kz94",
  "Kz95",
  "Kz96",
  "Kz98",
] as const;

export function formatElsterCsv(fields: ElsterFieldMap, meta: { label: string; year: string; period: string }): string {
  const lines = [
    `# UStVA ${meta.label} — import reference for Mein ELSTER`,
    `# Jahr;${meta.year}`,
    `# Zeitraum;${meta.period}`,
    `# Kennzahl;Betrag_EUR`,
  ];
  for (const key of ELSTER_KZ_ORDER) {
    const value = fields[key];
    if (value != null && value !== 0) {
      lines.push(`${key};${value.toFixed(2).replace(".", ",")}`);
    }
  }
  return lines.join("\n");
}
