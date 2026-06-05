import { COMPANY, COMPANY_NOTES } from "@/lib/company";

export function CompanyView() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <header className="mb-12 text-center">
          <h1 className="text-2xl font-medium tracking-tight text-white">{COMPANY.name}</h1>
          <p className="mt-2 text-sm text-zinc-600">{COMPANY.tagline}</p>
        </header>

        <div className="space-y-10">
          {COMPANY_NOTES.map((note) => (
            <section key={note.title}>
              <h2 className="mb-3 text-[10px] uppercase tracking-wider text-zinc-700">
                {note.title}
              </h2>
              <div className="space-y-2">
                {note.lines.map((line, i) =>
                  line.kind === "text" ? (
                    <p key={i} className="text-sm leading-relaxed text-zinc-400">
                      {line.value}
                    </p>
                  ) : (
                    <p key={i} className="text-[13px] text-zinc-600">
                      {line.value}
                    </p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
