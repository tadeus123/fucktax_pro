import {
  COMPANY,
  COMPANY_DEADLINES,
  COMPANY_MISSING,
  COMPANY_SECTIONS,
  type CompanyRow,
} from "@/lib/company";
import { formatShortDeadline, getDeadlineTone } from "@/lib/filings";

const deadlineToneClass = {
  overdue: "text-red-500",
  soon: "text-yellow-500",
  normal: "text-zinc-500",
} as const;

function Row({ label, value, note }: CompanyRow) {
  return (
    <div className="py-2">
      <div className="flex items-start justify-between gap-6">
        <span className="shrink-0 text-zinc-600">{label}</span>
        <span className="whitespace-pre-line text-right text-zinc-300">{value}</span>
      </div>
      {note ? <p className="mt-1 text-right text-[11px] text-zinc-600">{note}</p> : null}
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: CompanyRow[] }) {
  return (
    <section>
      <h2 className="mb-2 text-[10px] uppercase tracking-wider text-zinc-700">{title}</h2>
      <div className="divide-y divide-zinc-900/80">
        {rows.map((row) => (
          <Row key={row.label} {...row} />
        ))}
      </div>
    </section>
  );
}

export function CompanyView() {
  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-medium tracking-tight text-white">{COMPANY.name}</h1>
        <p className="mt-1 text-sm text-zinc-600">{COMPANY.tagline}</p>
      </header>

      <div className="space-y-10">
        <section>
          <h2 className="mb-2 text-[10px] uppercase tracking-wider text-zinc-700">deadlines</h2>
          <div className="divide-y divide-zinc-900/80">
            {COMPANY_DEADLINES.map((item) => {
              const tone = getDeadlineTone(item.date);
              return (
                <div key={item.label} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="text-zinc-600">{item.label}</span>
                  <div className="text-right">
                    <span className={`text-sm tabular-nums ${deadlineToneClass[tone]}`}>
                      {formatShortDeadline(item.date)}
                    </span>
                    {item.alt ? (
                      <p className="mt-0.5 text-[10px] text-zinc-700">{item.alt}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {COMPANY_SECTIONS.map((section) => (
          <Section key={section.title} title={section.title} rows={section.rows} />
        ))}

        <section>
          <h2 className="mb-2 text-[10px] uppercase tracking-wider text-zinc-700">
            needs confirmation
          </h2>
          <ul className="space-y-1.5">
            {COMPANY_MISSING.map((item) => (
              <li key={item} className="text-[13px] text-yellow-600/80">
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
