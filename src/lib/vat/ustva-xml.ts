import iconv from "iconv-lite";
import type { ElsterFieldMap } from "@/lib/vat/elster-fields";
import { ELSTER_KZ_ORDER } from "@/lib/vat/elster-fields";
import { USTVA_2025_FIELDS, ustvaNamespace } from "@/lib/vat/ustva-field-mapping";

const BASE_KZ = new Set(
  USTVA_2025_FIELDS.filter((f) => f.kind === "base").map((f) => f.kz),
);

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Tax bases: full euros. Tax/payable: rounded to cents then whole euro for XML import. */
export function formatKzXmlValue(kz: string, value: number): string {
  if (BASE_KZ.has(kz)) {
    return String(Math.round(value));
  }
  return String(Math.round(value));
}

export function buildUstvaImportXml(
  fields: ElsterFieldMap,
  meta: { year: string; period: string; steuernummer: string },
): string {
  const ns = ustvaNamespace(meta.year);

  const kzLines = ELSTER_KZ_ORDER.filter((k) => {
    const v = fields[k];
    return v != null && v !== 0;
  })
    .map((k) => `      <${k}>${formatKzXmlValue(k, fields[k]!)}</${k}>`)
    .join("\n");

  const kzBlock = kzLines ? `\n${kzLines}` : "";

  return `<?xml version="1.0" encoding="ISO-8859-15" standalone="no"?>
<Anmeldungssteuern xmlns="${ns}" version="${meta.year}">
  <Steuerfall>
    <Umsatzsteuervoranmeldung>
      <Jahr>${meta.year}</Jahr>
      <Zeitraum>${meta.period}</Zeitraum>
      <Steuernummer>${escapeXml(meta.steuernummer)}</Steuernummer>${kzBlock}
    </Umsatzsteuervoranmeldung>
  </Steuerfall>
</Anmeldungssteuern>`;
}

export function encodeUstvaXml(xml: string): Buffer {
  return iconv.encode(xml, "ISO-8859-15");
}

export function validateUstvaExport(input: {
  year: string;
  period: string;
  steuernummer: string;
  fields: ElsterFieldMap;
}): string[] {
  const errors: string[] = [];

  if (!input.year || !/^\d{4}$/.test(input.year)) {
    errors.push("Missing or invalid Jahr.");
  }

  if (!["41", "42", "43", "44", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].includes(input.period)) {
    errors.push("Invalid Zeitraum for UStVA.");
  }

  const steuer = input.steuernummer.replace(/\D/g, "");
  if (steuer.length < 10 || steuer.length > 13) {
    errors.push("Invalid Steuernummer — set ELSTER_STEUERNUMMER (10–13 digits, no slashes).");
  }

  const hasKz = Object.values(input.fields).some((v) => v != null && v !== 0);
  if (!hasKz) {
    errors.push("No VAT Kennzahlen (Kz) values — apply chat fixes so totals are filled before export.");
  }

  return errors;
}
