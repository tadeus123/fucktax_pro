import type { VatCaseId } from "@/lib/vat/cases";
import { roundEuro } from "@/lib/vat/elster-fields";
import { inferSupplierFromFilename, matchesVendorPattern } from "@/lib/vat/vendor-match";
import { createSupabaseAdmin } from "@/lib/supabase/server";

function looksLikeDateOnly(text: string): boolean {
  return /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(text.trim());
}

function isTokenizeFilename(filename: string): boolean {
  return matchesVendorPattern(filename, "tokenize") || /\bto25\d+/i.test(filename);
}

function parseInvoiceDateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

function deriveFromGross(gross: number, rate = 19): { net: number; vat: number } {
  const net = roundEuro(gross / (1 + rate / 100));
  return { net, vat: roundEuro(gross - net) };
}

function numFromUnknown(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Fix bad extractions (date as supplier, missing amounts) and infer gross from Tokenize bank lines. */
export async function repairBrokenSupplierRecords(
  filingPeriodId: string,
  sessionId: string,
  fileIds?: string[],
): Promise<{ repaired: number; bankFilled: number }> {
  const supabase = createSupabaseAdmin();

  let recordsQuery = supabase
    .from("document_records")
    .select(
      "id, file_id, counterparty_name, gross_amount, net_amount, vat_amount, vat_rate, invoice_date, raw_extraction, confidence",
    )
    .eq("filing_period_id", filingPeriodId);

  if (fileIds?.length) {
    recordsQuery = recordsQuery.in("file_id", fileIds);
  }

  const { data: records } = await recordsQuery;
  if (!records?.length) return { repaired: 0, bankFilled: 0 };

  const recordFileIds = [...new Set(records.map((r) => r.file_id))];
  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id, original_filename")
    .in("id", recordFileIds);

  const filenameById = new Map((files ?? []).map((f) => [f.id, f.original_filename] as const));

  const { data: transactions } = await supabase
    .from("bank_transactions")
    .select("id, amount, transaction_date, description, counterparty, matched_document_id")
    .eq("session_id", sessionId)
    .eq("reconciliation_status", "unmatched");

  const tokenizeTxs = (transactions ?? []).filter((tx) => {
    const hay = `${tx.description ?? ""} ${tx.counterparty ?? ""}`;
    return matchesVendorPattern(hay, "tokenize");
  });

  const usedTxIds = new Set<string>();
  let repaired = 0;
  let bankFilled = 0;

  const tokenizeRecords = records
    .filter((row) => isTokenizeFilename(filenameById.get(row.file_id) ?? ""))
    .sort((a, b) => {
      const da = a.invoice_date ?? parseInvoiceDateFromFilename(filenameById.get(a.file_id) ?? "") ?? "";
      const db = b.invoice_date ?? parseInvoiceDateFromFilename(filenameById.get(b.file_id) ?? "") ?? "";
      return da.localeCompare(db);
    });

  for (const row of tokenizeRecords) {
    const filename = filenameById.get(row.file_id) ?? "";
    const supplier = inferSupplierFromFilename(filename);
    const cp = row.counterparty_name ?? "";
    const needsCounterpartyFix =
      supplier != null &&
      (looksLikeDateOnly(cp) || /huge production/i.test(cp) || !cp.trim());

    let gross =
      row.gross_amount != null
        ? Number(row.gross_amount)
        : numFromUnknown((row.raw_extraction as Record<string, unknown> | null)?.gross_amount);

    if ((gross == null || gross <= 0) && tokenizeTxs.length > 0) {
      const invoiceDate =
        row.invoice_date ?? parseInvoiceDateFromFilename(filename) ?? undefined;
      let bestTx: (typeof tokenizeTxs)[number] | null = null;
      let bestDays = 999;

      for (const tx of tokenizeTxs) {
        if (tx.matched_document_id || usedTxIds.has(tx.id)) continue;
        const abs = Math.abs(Number(tx.amount));
        if (abs < 10) continue;

        if (invoiceDate) {
          const days = daysBetween(String(invoiceDate), tx.transaction_date);
          if (days < bestDays) {
            bestDays = days;
            bestTx = tx;
          }
        } else if (!bestTx) {
          bestTx = tx;
        }
      }

      if (bestTx && (bestDays <= 45 || !invoiceDate)) {
        gross = roundEuro(Math.abs(Number(bestTx.amount)));
        usedTxIds.add(bestTx.id);
        bankFilled += 1;
      }
    }

    if (!needsCounterpartyFix && (gross == null || gross <= 0)) continue;

    const rate = row.vat_rate != null ? Number(row.vat_rate) : 19;
    const derived = gross != null && gross > 0 ? deriveFromGross(gross, rate) : null;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (needsCounterpartyFix && supplier) {
      updates.counterparty_name = supplier.includes("Tokenize")
        ? "Tokenize.it GmbH"
        : supplier;
      updates.document_type = "supplier_invoice";
      updates.risk_status = "de_supplier_19" satisfies VatCaseId;
    }

    if (derived) {
      updates.gross_amount = gross;
      updates.net_amount = derived.net;
      updates.vat_amount = derived.vat;
      updates.vat_rate = rate;
      updates.confidence = "likely";
      updates.risk_status = "de_supplier_19";
    }

    if (Object.keys(updates).length <= 1) continue;

    const { error } = await supabase.from("document_records").update(updates).eq("id", row.id);
    if (!error) repaired += 1;
  }

  return { repaired, bankFilled };
}

/** File IDs for Tokenize / to25* invoices in the session (incl. duplicates). */
export async function tokenizeFileIdsInSession(sessionId: string): Promise<string[]> {
  const supabase = createSupabaseAdmin();
  const { data: files } = await supabase
    .from("uploaded_files")
    .select("id, original_filename")
    .eq("session_id", sessionId)
    .eq("kind", "document");

  return (files ?? [])
    .filter((f) => isTokenizeFilename(f.original_filename))
    .map((f) => f.id);
}

export function pickDocumentsForReply<
  T extends { filename: string; counterparty: string | null; grossAmount?: number | null },
>(docs: T[], userMessage?: string, max = 12): T[] {
  const msg = (userMessage ?? "").toLowerCase();

  if (/tokenize|to25\d/.test(msg)) {
    const tokenize = docs.filter((d) => isTokenizeFilename(d.filename));
    if (tokenize.length > 0) return tokenize.slice(0, max);
  }

  const mentioned = docs.filter((d) => {
    const base = d.filename.toLowerCase();
    const short = base.split("/").pop() ?? base;
    return msg.includes(short.slice(0, 20)) || (msg.includes("to25") && /\bto25\d+/i.test(base));
  });
  if (mentioned.length > 0) return mentioned.slice(0, max);

  const withAmounts = docs.filter((d) => (d.grossAmount ?? 0) > 0);
  if (withAmounts.length > 0 && withAmounts.length <= max) return withAmounts;

  if (docs.length <= max) return docs;
  return docs.filter((d) => (d.grossAmount ?? 0) > 0).slice(0, max);
}
