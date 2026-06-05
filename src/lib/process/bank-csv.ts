export type ParsedBankRow = {
  transactionDate: string;
  valueDate: string | null;
  amount: number;
  currency: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
};

function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ";" : ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseGermanNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/€|EUR/gi, "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  if (cleaned.includes(",")) {
    return Number(cleaned.replace(",", "."));
  }
  return Number(cleaned);
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const de = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (de) {
    return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function findColumn(headers: string[], patterns: RegExp[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (const pattern of patterns) {
    const idx = lower.findIndex((h) => pattern.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseBankCsv(buffer: Buffer): ParsedBankRow[] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);

  const dateIdx = findColumn(headers, [/date/i, /datum/i, /booking/i, /buchung/i]);
  const valueDateIdx = findColumn(headers, [/value/i, /valuta/i, /wertstellung/i]);
  const amountIdx = findColumn(headers, [/amount/i, /betrag/i, /sum/i, /umsatz/i]);
  const descIdx = findColumn(headers, [/description/i, /beschreibung/i, /details/i, /text/i, /memo/i]);
  const counterpartyIdx = findColumn(headers, [/counterparty/i, /payee/i, /name/i, /empf/i, /partner/i]);
  const refIdx = findColumn(headers, [/reference/i, /ref/i, /verwend/i]);

  if (dateIdx < 0 || amountIdx < 0) return [];

  const rows: ParsedBankRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line, delimiter);
    const transactionDate = parseDate(cells[dateIdx] ?? "");
    const amount = parseGermanNumber(cells[amountIdx] ?? "");
    if (!transactionDate || amount === null || Number.isNaN(amount)) continue;

    rows.push({
      transactionDate,
      valueDate: valueDateIdx >= 0 ? parseDate(cells[valueDateIdx] ?? "") : null,
      amount,
      currency: "EUR",
      description: (cells[descIdx] ?? cells[counterpartyIdx] ?? "").trim(),
      counterparty: counterpartyIdx >= 0 ? cells[counterpartyIdx]?.trim() || null : null,
      reference: refIdx >= 0 ? cells[refIdx]?.trim() || null : null,
    });
  }

  return rows;
}

export function dedupeBankRows(rows: ParsedBankRow[]): ParsedBankRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.transactionDate}|${row.amount}|${row.description}|${row.counterparty ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
