export type ElsterFieldMap = Record<string, number>;

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

export function roundEuro(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildElsterFieldMap(rollup: Omit<VatRollupResult, "elsterFields">): ElsterFieldMap {
  const fields: ElsterFieldMap = {};

  if (rollup.outputNet19 > 0) fields.Kz81 = roundEuro(rollup.outputNet19);
  if (rollup.outputTax19 > 0) fields.Kz86 = roundEuro(rollup.outputTax19);
  if (rollup.outputNet7 > 0) fields.Kz35 = roundEuro(rollup.outputNet7);
  if (rollup.outputTax7 > 0) fields.Kz36 = roundEuro(rollup.outputTax7);

  if (rollup.reverseChargeNetEu > 0) fields.Kz46 = roundEuro(rollup.reverseChargeNetEu);
  if (rollup.reverseChargeTaxEu > 0) fields.Kz47 = roundEuro(rollup.reverseChargeTaxEu);
  if (rollup.reverseChargeNetNonEu > 0) fields.Kz84 = roundEuro(rollup.reverseChargeNetNonEu);
  if (rollup.reverseChargeTaxNonEu > 0) fields.Kz85 = roundEuro(rollup.reverseChargeTaxNonEu);

  if (rollup.inputVatDeductible > 0) fields.Kz66 = roundEuro(rollup.inputVatDeductible);
  if (rollup.reverseChargeInputVat > 0) fields.Kz67 = roundEuro(rollup.reverseChargeInputVat);

  const payable = roundEuro(rollup.vatPayable);
  if (payable !== 0) fields.Kz83 = payable;

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

export function formatElsterXml(
  fields: ElsterFieldMap,
  meta: { year: string; period: string; steuernummer: string },
): string {
  const kzLines = ELSTER_KZ_ORDER.filter((k) => {
    const v = fields[k];
    return v != null && v !== 0;
  })
    .map((k) => `              <${k}>${fields[k]!.toFixed(2)}</${k}>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">
  <DatenTeil>
    <Nutzdatenblock>
      <Nutzdaten>
        <Anmeldungssteuern xmlns="http://finkonsens.de/elster/elsteranmeldung/ustva/v2025" version="2025">
          <Steuerfall>
            <Umsatzsteuervoranmeldung>
              <Jahr>${meta.year}</Jahr>
              <Zeitraum>${meta.period}</Zeitraum>
              <Steuernummer>${meta.steuernummer}</Steuernummer>
${kzLines}
            </Umsatzsteuervoranmeldung>
          </Steuerfall>
        </Anmeldungssteuern>
      </Nutzdaten>
    </Nutzdatenblock>
  </DatenTeil>
</Elster>
`;
}
