/**
 * UStVA Kennzahlen mapping for Mein ELSTER XML import.
 * Update here after real ELSTER upload tests if a Kz lands on the wrong line.
 */
export type UstvaFieldKind = "base" | "tax" | "payable" | "input";

export type UstvaFieldDef = {
  kz: string;
  label: string;
  kind: UstvaFieldKind;
  rollupKey:
    | "outputNet19"
    | "outputTax19"
    | "outputNet7"
    | "outputTax7"
    | "reverseChargeNetEu"
    | "reverseChargeTaxEu"
    | "reverseChargeNetNonEu"
    | "reverseChargeTaxNonEu"
    | "inputVatDeductible"
    | "reverseChargeInputVat"
    | "vatPayable";
};

export const USTVA_2025_FIELDS: UstvaFieldDef[] = [
  { kz: "Kz81", label: "Umsätze 19% Bemessungsgrundlage", kind: "base", rollupKey: "outputNet19" },
  { kz: "Kz83", label: "Umsätze 19% Steuer", kind: "tax", rollupKey: "outputTax19" },
  { kz: "Kz86", label: "Umsätze 7% Bemessungsgrundlage", kind: "base", rollupKey: "outputNet7" },
  { kz: "Kz36", label: "Umsätze 7% Steuer", kind: "tax", rollupKey: "outputTax7" },
  { kz: "Kz46", label: "§13b EU Dienstleistungen Netto", kind: "base", rollupKey: "reverseChargeNetEu" },
  { kz: "Kz47", label: "§13b EU Dienstleistungen Steuer", kind: "tax", rollupKey: "reverseChargeTaxEu" },
  { kz: "Kz84", label: "§13b Drittland Dienstleistungen Netto", kind: "base", rollupKey: "reverseChargeNetNonEu" },
  { kz: "Kz85", label: "§13b Drittland Dienstleistungen Steuer", kind: "tax", rollupKey: "reverseChargeTaxNonEu" },
  { kz: "Kz66", label: "Abziehbare Vorsteuer", kind: "input", rollupKey: "inputVatDeductible" },
  { kz: "Kz67", label: "Vorsteuer §13b / ig. Erwerb", kind: "input", rollupKey: "reverseChargeInputVat" },
  { kz: "Kz98", label: "Verbleibende Umsatzsteuer-Vorauszahlung", kind: "payable", rollupKey: "vatPayable" },
];

export const QUARTER_TO_ZEITRAUM = {
  Q1: "41",
  Q2: "42",
  Q3: "43",
  Q4: "44",
} as const;

export function ustvaNamespace(year: string): string {
  return `http://finkonsens.de/elster/elsteranmeldung/ustva/v${year}`;
}
