import { COMPANY, COMPANY_SECTIONS, type CompanyRow } from "@/lib/company";

function Row({ label, value }: CompanyRow) {
  return (
    <div className="flex items-start justify-between gap-8 py-2.5">
      <span className="text-zinc-600">{label}</span>
      <span className="whitespace-pre-line text-right text-zinc-300">{value}</span>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: CompanyRow[] }) {
  return (
    <section>
      <h2 className="mb-3 text-[10px] uppercase tracking-wider text-zinc-700">{title}</h2>
      <div className="divide-y divide-zinc-900">
        {rows.map((row) => (
          <Row key={row.label} {...row} />
        ))}
      </div>
    </section>
  );
}

export function CompanyView() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <header className="mb-12 text-center">
          <h1 className="text-2xl font-medium tracking-tight text-white">{COMPANY.name}</h1>
          <p className="mt-2 text-sm text-zinc-600">{COMPANY.tagline}</p>
        </header>

        <div className="space-y-10 text-sm">
          {COMPANY_SECTIONS.map((section) => (
            <Section key={section.title} title={section.title} rows={section.rows} />
          ))}
        </div>
      </div>
    </div>
  );
}
