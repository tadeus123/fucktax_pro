import type { VatCaseId } from "@/lib/vat/cases";
import { classifyUnmatchedBankLine } from "@/lib/vat/classify-bank";
import { searchFilingData } from "@/lib/vat/build-filing-context";
import { getRecoveryOpportunities } from "@/lib/vat/bank-triage";
import { buildElsterExport } from "@/lib/vat/export-elster";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export type ApplyResult = {
  ok: boolean;
  message: string;
  affected?: number;
};

async function getSessionId(filingPeriodId: string): Promise<string | null> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

function matchesPattern(text: string, pattern: string): boolean {
  return text.toLowerCase().includes(pattern.toLowerCase().trim());
}

export async function excludeDocumentsMatching(
  filingPeriodId: string,
  pattern: string,
  reason: string,
): Promise<ApplyResult> {
  const supabase = createSupabaseAdmin();
  const { data: records } = await supabase
    .from("document_records")
    .select("id, counterparty_name, file_id")
    .eq("filing_period_id", filingPeriodId);

  const { data: files } = await supabase.from("uploaded_files").select("id, original_filename");
  const filenameById = new Map((files ?? []).map((f) => [f.id, f.original_filename] as const));

  const ids = (records ?? [])
    .filter((row) => {
      const filename = filenameById.get(row.file_id) ?? "";
      const cp = row.counterparty_name ?? "";
      return matchesPattern(filename, pattern) || matchesPattern(cp, pattern);
    })
    .map((row) => row.id);

  if (ids.length === 0) {
    return { ok: true, message: `No documents matched "${pattern}".`, affected: 0 };
  }

  const { error } = await supabase
    .from("document_records")
    .update({
      confidence: "do_not_deduct",
      risk_status: "private_mixed",
      warning: reason,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    message: `Excluded ${ids.length} document(s) matching "${pattern}" from ELSTER.`,
    affected: ids.length,
  };
}

export async function setDocumentFiling(
  filingPeriodId: string,
  args: {
    pattern: string;
    vat_case: VatCaseId;
    confidence?: string;
    gross_amount?: number;
    net_amount?: number;
    vat_amount?: number;
    vat_rate?: number;
    note?: string;
  },
): Promise<ApplyResult> {
  const supabase = createSupabaseAdmin();
  const { data: records } = await supabase
    .from("document_records")
    .select("id, counterparty_name, file_id")
    .eq("filing_period_id", filingPeriodId);

  const { data: files } = await supabase.from("uploaded_files").select("id, original_filename");
  const filenameById = new Map((files ?? []).map((f) => [f.id, f.original_filename] as const));

  const match = (records ?? []).filter((row) => {
    const filename = filenameById.get(row.file_id) ?? "";
    const cp = row.counterparty_name ?? "";
    return matchesPattern(filename, args.pattern) || matchesPattern(cp, args.pattern);
  });

  if (match.length === 0) {
    return { ok: true, message: `No documents matched "${args.pattern}".`, affected: 0 };
  }

  const updates: Record<string, unknown> = {
    risk_status: args.vat_case,
    confidence: args.confidence ?? "safe",
    warning: args.note ?? null,
    updated_at: new Date().toISOString(),
  };
  if (args.gross_amount != null) updates.gross_amount = args.gross_amount;
  if (args.net_amount != null) updates.net_amount = args.net_amount;
  if (args.vat_amount != null) updates.vat_amount = args.vat_amount;
  if (args.vat_rate != null) updates.vat_rate = args.vat_rate;

  const { error } = await supabase
    .from("document_records")
    .update(updates)
    .in(
      "id",
      match.map((m) => m.id),
    );

  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    message: `Updated ${match.length} document(s) as ${args.vat_case} for ELSTER.`,
    affected: match.length,
  };
}

export async function confirmBankLinesMatching(
  filingPeriodId: string,
  pattern: string,
  vatCase: string,
  note: string,
): Promise<ApplyResult> {
  const sessionId = await getSessionId(filingPeriodId);
  if (!sessionId) return { ok: false, message: "No upload session." };

  const supabase = createSupabaseAdmin();
  const { data: lines } = await supabase
    .from("bank_transactions")
    .select("id, description, counterparty")
    .eq("session_id", sessionId)
    .eq("reconciliation_status", "unmatched");

  const ids = (lines ?? [])
    .filter((line) => {
      const text = `${line.description ?? ""} ${line.counterparty ?? ""}`;
      return matchesPattern(text, pattern);
    })
    .map((line) => line.id);

  if (ids.length === 0) {
    return { ok: true, message: `No unmatched bank lines matched "${pattern}".`, affected: 0 };
  }

  const { error } = await supabase
    .from("bank_transactions")
    .update({
      treatment_case: vatCase,
      treatment_note: note,
      user_confirmed: true,
      reconciliation_status: "resolved",
    })
    .in("id", ids);

  if (error) {
    if (error.message.includes("treatment_case")) {
      return {
        ok: false,
        message: "Run supabase/review-chat.sql to enable chat resolutions on bank lines.",
      };
    }
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    message: `Confirmed ${ids.length} bank line(s) as ${vatCase}.`,
    affected: ids.length,
  };
}

export async function excludeBankLinesMatching(
  filingPeriodId: string,
  pattern: string,
  note: string,
): Promise<ApplyResult> {
  return confirmBankLinesMatching(filingPeriodId, pattern, "internal_transfer", note);
}

export async function applySmartDefaults(filingPeriodId: string): Promise<ApplyResult> {
  const results: string[] = [];
  let total = 0;

  const r1 = await excludeBankLinesMatching(
    filingPeriodId,
    "transfer to another wallet",
    "Internal wallet — excluded via smart defaults",
  );
  if (r1.affected) total += r1.affected;
  results.push(r1.message);

  const r2 = await excludeBankLinesMatching(
    filingPeriodId,
    "transfer from another wallet",
    "Internal wallet — excluded via smart defaults",
  );
  if (r2.affected) total += r2.affected;
  results.push(r2.message);

  for (const pattern of ["cursor", "notion", "paddle", "snap inc"]) {
    const rc = await confirmBankLinesMatching(
      filingPeriodId,
      pattern,
      "non_eu_service_rc",
      "Reverse charge from bank — smart default",
    );
    if (rc.affected) total += rc.affected;
    results.push(rc.message);
  }

  for (const pattern of ["safeway", "walgreens", "ben & jerry", "clipper", "transit fare"]) {
    const rd = await excludeDocumentsMatching(
      filingPeriodId,
      pattern,
      "Private / non-deductible — smart default",
    );
    if (rd.affected) total += rd.affected;
    const rb = await excludeBankLinesMatching(
      filingPeriodId,
      pattern,
      "Private / non-deductible — smart default",
    );
    if (rb.affected) total += rb.affected;
  }

  const sessionId = await getSessionId(filingPeriodId);
  if (sessionId) {
    const supabase = createSupabaseAdmin();
    const { data: lines } = await supabase
      .from("bank_transactions")
      .select("id, description, counterparty, amount")
      .eq("session_id", sessionId)
      .eq("reconciliation_status", "unmatched")
      .eq("user_confirmed", false);

    for (const line of lines ?? []) {
      const c = classifyUnmatchedBankLine(line.description, line.counterparty, Number(line.amount));
      if (c.action === "ignore") {
        await supabase
          .from("bank_transactions")
          .update({
            treatment_case: c.vatCase,
            treatment_note: c.suggestion,
            user_confirmed: true,
            reconciliation_status: "resolved",
          })
          .eq("id", line.id);
        total += 1;
      }
    }
  }

  return {
    ok: true,
    message: `Smart defaults applied (${total} items). ${results.filter((m) => m.includes("Confirmed") || m.includes("Excluded")).join(" ")}`,
    affected: total,
  };
}

export async function refreshElsterExport(filingPeriodId: string): Promise<ApplyResult & {
  vatPayable?: number;
  elsterFields?: Record<string, number>;
  includedDocuments?: number;
  excludedDocuments?: number;
  warnings?: string[];
}> {
  const pkg = await buildElsterExport(filingPeriodId);
  if (!pkg) return { ok: false, message: "Could not rebuild ELSTER export." };

  return {
    ok: true,
    message: `ELSTER file updated. VAT payable: ${pkg.rollup.vatPayable.toFixed(2)} EUR.`,
    vatPayable: pkg.rollup.vatPayable,
    elsterFields: pkg.rollup.elsterFields,
    includedDocuments: pkg.rollup.includedDocuments,
    excludedDocuments: pkg.rollup.excludedDocuments,
    warnings: pkg.rollup.warnings,
  };
}

export async function executeAssistantTool(
  filingPeriodId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ApplyResult & Record<string, unknown>> {
  switch (name) {
    case "exclude_documents_matching":
      return excludeDocumentsMatching(
        filingPeriodId,
        String(args.pattern ?? ""),
        String(args.reason ?? "Excluded by user in chat"),
      );
    case "set_document_filing":
      return setDocumentFiling(filingPeriodId, {
        pattern: String(args.pattern ?? ""),
        vat_case: String(args.vat_case ?? "private_mixed") as VatCaseId,
        confidence: args.confidence ? String(args.confidence) : undefined,
        gross_amount: args.gross_amount != null ? Number(args.gross_amount) : undefined,
        net_amount: args.net_amount != null ? Number(args.net_amount) : undefined,
        vat_amount: args.vat_amount != null ? Number(args.vat_amount) : undefined,
        vat_rate: args.vat_rate != null ? Number(args.vat_rate) : undefined,
        note: args.note ? String(args.note) : undefined,
      });
    case "confirm_bank_lines_matching":
      return confirmBankLinesMatching(
        filingPeriodId,
        String(args.pattern ?? ""),
        String(args.vat_case ?? "non_eu_service_rc"),
        String(args.note ?? "Confirmed in chat"),
      );
    case "exclude_bank_lines_matching":
      return excludeBankLinesMatching(
        filingPeriodId,
        String(args.pattern ?? ""),
        String(args.note ?? "Excluded in chat"),
      );
    case "get_recovery_opportunities":
      return (await getRecoveryOpportunities(filingPeriodId)) as ApplyResult & Record<string, unknown>;
    case "search_filing_data":
      return (await searchFilingData(
        filingPeriodId,
        String(args.pattern ?? ""),
        (args.scope as "bank" | "documents" | "both") ?? "both",
        args.limit != null ? Number(args.limit) : 25,
      )) as ApplyResult & Record<string, unknown>;
    case "apply_smart_defaults":
      return applySmartDefaults(filingPeriodId);
    case "refresh_elster_export": {
      const refreshed = await refreshElsterExport(filingPeriodId);
      return {
        ok: refreshed.ok,
        message: refreshed.message,
        vatPayable: refreshed.vatPayable,
        includedDocuments: refreshed.includedDocuments,
        excludedDocuments: refreshed.excludedDocuments,
        warnings: refreshed.warnings?.slice(0, 8),
      };
    }
    default:
      return { ok: false, message: `Unknown tool: ${name}` };
  }
}
