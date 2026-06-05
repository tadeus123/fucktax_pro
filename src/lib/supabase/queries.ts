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
