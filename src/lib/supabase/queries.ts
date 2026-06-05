import type { CompanyLine, CompanyNote } from "@/lib/company";
import type { FilingStatus, GenericFiling, VatFiling } from "@/lib/filings";
import { createSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

type FilingPeriodRow = {
  id: string;
  filing_type: "vat" | "jahresabschluss" | "steuer";
  label: string;
  sidebar_label: string | null;
  period_start: string | null;
  period_end: string | null;
  period_label: string | null;
  deadline: string;
  deadline_label: string;
  status: FilingStatus;
  description: string | null;
  route_segment: string;
};

export type SidebarFiling = {
  href: string;
  label: string;
  deadline: string;
  filingType: FilingPeriodRow["filing_type"];
};

export type CompanyContent = {
  name: string;
  tagline: string;
  notes: CompanyNote[];
};

function supabaseRequired() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is required. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createSupabaseAdmin();
}

function filingHref(row: FilingPeriodRow): string {
  const base =
    row.filing_type === "vat"
      ? "vat"
      : row.filing_type === "jahresabschluss"
        ? "jahresabschluss"
        : "steuer";
  return `/${base}/${row.route_segment}`;
}

function sidebarLabel(row: FilingPeriodRow): string {
  return row.sidebar_label?.trim() || row.label;
}

function rowToVatFiling(row: FilingPeriodRow): VatFiling {
  return {
    id: row.id,
    label: row.label,
    periodStart: row.period_start ?? "",
    periodEnd: row.period_end ?? "",
    deadline: row.deadline,
    deadlineLabel: row.deadline_label,
    status: row.status,
  };
}

function rowToGenericFiling(row: FilingPeriodRow): GenericFiling {
  return {
    id: row.route_segment,
    label: row.label,
    periodLabel: row.period_label ?? "",
    deadline: row.deadline,
    deadlineLabel: row.deadline_label,
    status: row.status,
    description: row.description ?? "",
  };
}

export async function getSidebarFilings(): Promise<SidebarFiling[]> {
  const supabase = supabaseRequired();
  const { data, error } = await supabase
    .from("filing_periods")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Could not load filing periods: ${error.message}`);
  }

  return (data as FilingPeriodRow[]).map((row) => ({
    href: filingHref(row),
    label: sidebarLabel(row),
    deadline: row.deadline,
    filingType: row.filing_type,
  }));
}

export async function getVatFilingByRoute(route: string): Promise<VatFiling | null> {
  const supabase = supabaseRequired();
  const { data, error } = await supabase
    .from("filing_periods")
    .select("*")
    .eq("filing_type", "vat")
    .or(`id.eq.${route},route_segment.eq.${route}`)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load VAT filing: ${error.message}`);
  }

  return data ? rowToVatFiling(data as FilingPeriodRow) : null;
}

export async function getGenericFilingByRoute(
  type: "jahresabschluss" | "steuer",
  route: string,
): Promise<GenericFiling | null> {
  const supabase = supabaseRequired();
  const { data, error } = await supabase
    .from("filing_periods")
    .select("*")
    .eq("filing_type", type)
    .or(`id.eq.${route},route_segment.eq.${route}`)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load filing: ${error.message}`);
  }

  return data ? rowToGenericFiling(data as FilingPeriodRow) : null;
}

export async function getCompanyContent(): Promise<CompanyContent> {
  const supabase = supabaseRequired();

  const [{ data: profile, error: profileError }, { data: sections, error: sectionsError }, { data: lines, error: linesError }] =
    await Promise.all([
      supabase.from("company_profile").select("name, tagline").eq("id", 1).maybeSingle(),
      supabase.from("company_sections").select("id, title, sort_order").order("sort_order"),
      supabase.from("company_lines").select("section_id, kind, value, sort_order").order("sort_order"),
    ]);

  const error = profileError ?? sectionsError ?? linesError;
  if (error) {
    throw new Error(`Could not load company content: ${error.message}`);
  }

  if (!profile || !sections?.length || !lines?.length) {
    throw new Error("Company content is missing in Supabase. Run supabase/addon.sql.");
  }

  const notes: CompanyNote[] = sections.map((section) => ({
    title: section.title,
    lines: (lines as Array<{ section_id: number; kind: string; value: string; sort_order: number }>)
      .filter((line) => line.section_id === section.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(
        (line): CompanyLine => ({
          kind: line.kind as "text" | "data",
          value: line.value,
        }),
      ),
  }));

  return {
    name: profile.name,
    tagline: profile.tagline,
    notes,
  };
}

export async function getOrCreateUploadSession(filingPeriodId: string): Promise<string> {
  const supabase = supabaseRequired();

  const { data: existing } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("upload_sessions")
    .insert({ filing_period_id: filingPeriodId })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Could not create upload session");
  }

  return created.id;
}

export type UploadStatus = {
  sessionId: string | null;
  documents: number;
  bank: number;
  sessionStatus: string | null;
  hasProcessed: boolean;
};

export async function getUploadStatus(filingPeriodId: string): Promise<UploadStatus> {
  const supabase = supabaseRequired();

  const { data: session } = await supabase
    .from("upload_sessions")
    .select("id, status")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return {
      sessionId: null,
      documents: 0,
      bank: 0,
      sessionStatus: null,
      hasProcessed: false,
    };
  }

  const { data: files } = await supabase
    .from("uploaded_files")
    .select("kind")
    .eq("session_id", session.id);

  const documents = files?.filter((f) => f.kind === "document").length ?? 0;
  const bank = files?.filter((f) => f.kind === "bank").length ?? 0;

  const { count: recordCount } = await supabase
    .from("document_records")
    .select("id", { count: "exact", head: true })
    .eq("filing_period_id", filingPeriodId);

  return {
    sessionId: session.id,
    documents,
    bank,
    sessionStatus: session.status,
    hasProcessed: (recordCount ?? 0) > 0,
  };
}

export type ReviewDocument = {
  id: string;
  filename: string;
  documentType: string | null;
  counterparty: string | null;
  invoiceDate: string | null;
  grossAmount: number | null;
  vatRate: number | null;
  vatAmount: number | null;
  confidence: string | null;
  warning: string | null;
  matched: boolean;
};

export type ReviewBankLine = {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  counterparty: string | null;
  status: string;
};

export type ReviewData = {
  filingLabel: string;
  periodRange: string;
  documents: ReviewDocument[];
  unmatchedBank: ReviewBankLine[];
  stats: {
    documents: number;
    bankLines: number;
    matched: number;
    needsReview: number;
  };
};

export async function getReviewData(filingPeriodId: string): Promise<ReviewData | null> {
  const supabase = supabaseRequired();

  const { data: filing } = await supabase
    .from("filing_periods")
    .select("label, period_start, period_end")
    .eq("id", filingPeriodId)
    .maybeSingle();

  if (!filing) return null;

  const { data: session } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) return null;

  const [{ data: records }, { data: bank }, { data: files }] = await Promise.all([
    supabase
      .from("document_records")
      .select(
        "id, document_type, counterparty_name, invoice_date, gross_amount, vat_rate, vat_amount, confidence, warning, file_id",
      )
      .eq("filing_period_id", filingPeriodId)
      .order("invoice_date", { ascending: false }),
    supabase
      .from("bank_transactions")
      .select("id, transaction_date, amount, description, counterparty, reconciliation_status")
      .eq("session_id", session.id)
      .order("transaction_date", { ascending: false }),
    supabase
      .from("uploaded_files")
      .select("id, original_filename")
      .eq("session_id", session.id),
  ]);

  const filenameByFileId = new Map(
    (files ?? []).map((file) => [file.id, file.original_filename] as const),
  );

  const { data: matchedIds } = await supabase
    .from("bank_transactions")
    .select("matched_document_id")
    .eq("session_id", session.id)
    .not("matched_document_id", "is", null);

  const matchedDocIds = new Set(
    (matchedIds ?? []).map((row) => row.matched_document_id).filter(Boolean),
  );

  const documents: ReviewDocument[] = (records ?? []).map((row) => ({
    id: row.id,
    filename: filenameByFileId.get(row.file_id) ?? "unknown",
    documentType: row.document_type,
    counterparty: row.counterparty_name,
    invoiceDate: row.invoice_date,
    grossAmount: row.gross_amount != null ? Number(row.gross_amount) : null,
    vatRate: row.vat_rate != null ? Number(row.vat_rate) : null,
    vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
    confidence: row.confidence,
    warning: row.warning,
    matched: matchedDocIds.has(row.id),
  }));

  const unmatchedBank: ReviewBankLine[] = (bank ?? [])
    .filter((row) => row.reconciliation_status !== "matched")
    .map((row) => ({
      id: row.id,
      date: row.transaction_date,
      amount: Number(row.amount),
      description: row.description,
      counterparty: row.counterparty,
      status: row.reconciliation_status,
    }));

  const periodRange =
    filing.period_start && filing.period_end
      ? `${filing.period_start} – ${filing.period_end}`
      : "";

  return {
    filingLabel: filing.label,
    periodRange,
    documents,
    unmatchedBank,
    stats: {
      documents: documents.length,
      bankLines: bank?.length ?? 0,
      matched: matchedDocIds.size,
      needsReview: documents.filter((d) => d.confidence === "review" || d.confidence === "do_not_deduct").length,
    },
  };
}
