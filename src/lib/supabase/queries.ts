import {
  COMPANY,
  COMPANY_NOTES,
  type CompanyLine,
  type CompanyNote,
} from "@/lib/company";
import {
  JAHRESABSCHLUSS,
  STEUERERKLAERUNG,
  VAT_FILINGS,
  type FilingStatus,
  type GenericFiling,
  type VatFiling,
} from "@/lib/filings";
import { createSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

type FilingPeriodRow = {
  id: string;
  filing_type: "vat" | "jahresabschluss" | "steuer";
  label: string;
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
  if (row.filing_type === "jahresabschluss") return "JA 2025";
  if (row.filing_type === "steuer") return "Tax 2025";
  return row.label;
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
  if (!isSupabaseConfigured()) {
    return [
      ...VAT_FILINGS.map((f) => ({
        href: `/vat/${f.id}`,
        label: f.label,
        deadline: f.deadline,
        filingType: "vat" as const,
      })),
      ...JAHRESABSCHLUSS.map((f) => ({
        href: `/jahresabschluss/${f.id}`,
        label: "JA 2025",
        deadline: f.deadline,
        filingType: "jahresabschluss" as const,
      })),
      ...STEUERERKLAERUNG.map((f) => ({
        href: `/steuer/${f.id}`,
        label: "Tax 2025",
        deadline: f.deadline,
        filingType: "steuer" as const,
      })),
    ];
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("filing_periods")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error || !data) {
    return getSidebarFilingsFallback();
  }

  return (data as FilingPeriodRow[]).map((row) => ({
    href: filingHref(row),
    label: sidebarLabel(row),
    deadline: row.deadline,
    filingType: row.filing_type,
  }));
}

function getSidebarFilingsFallback(): SidebarFiling[] {
  return [
    ...VAT_FILINGS.map((f) => ({
      href: `/vat/${f.id}`,
      label: f.label,
      deadline: f.deadline,
      filingType: "vat" as const,
    })),
    ...JAHRESABSCHLUSS.map((f) => ({
      href: `/jahresabschluss/${f.id}`,
      label: "JA 2025",
      deadline: f.deadline,
      filingType: "jahresabschluss" as const,
    })),
    ...STEUERERKLAERUNG.map((f) => ({
      href: `/steuer/${f.id}`,
      label: "Tax 2025",
      deadline: f.deadline,
      filingType: "steuer" as const,
    })),
  ];
}

export async function getVatFilingByRoute(route: string): Promise<VatFiling | null> {
  if (!isSupabaseConfigured()) {
    return VAT_FILINGS.find((f) => f.id === route) ?? null;
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("filing_periods")
    .select("*")
    .eq("filing_type", "vat")
    .or(`id.eq.${route},route_segment.eq.${route}`)
    .maybeSingle();

  if (error || !data) {
    return VAT_FILINGS.find((f) => f.id === route) ?? null;
  }

  return rowToVatFiling(data as FilingPeriodRow);
}

export async function getGenericFilingByRoute(
  type: "jahresabschluss" | "steuer",
  route: string,
): Promise<GenericFiling | null> {
  const fallback =
    type === "jahresabschluss"
      ? JAHRESABSCHLUSS.find((f) => f.id === route)
      : STEUERERKLAERUNG.find((f) => f.id === route);

  if (!isSupabaseConfigured()) {
    return fallback ?? null;
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("filing_periods")
    .select("*")
    .eq("filing_type", type)
    .or(`id.eq.${route},route_segment.eq.${route}`)
    .maybeSingle();

  if (error || !data) {
    return fallback ?? null;
  }

  return rowToGenericFiling(data as FilingPeriodRow);
}

export async function getCompanyContent(): Promise<CompanyContent> {
  if (!isSupabaseConfigured()) {
    return { name: COMPANY.name, tagline: COMPANY.tagline, notes: COMPANY_NOTES };
  }

  const supabase = createSupabaseAdmin();

  const [{ data: profile }, { data: sections }, { data: lines }] = await Promise.all([
    supabase.from("company_profile").select("name, tagline").eq("id", 1).maybeSingle(),
    supabase.from("company_sections").select("id, title, sort_order").order("sort_order"),
    supabase.from("company_lines").select("section_id, kind, value, sort_order").order("sort_order"),
  ]);

  if (!profile || !sections || !lines) {
    return { name: COMPANY.name, tagline: COMPANY.tagline, notes: COMPANY_NOTES };
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
  const supabase = createSupabaseAdmin();

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
