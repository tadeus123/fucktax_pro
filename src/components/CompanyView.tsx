import { COMPANY, COMPANY_NOTES, type CompanyNote } from "@/lib/company";

function Section({ note }: { note: CompanyNote }) {
  const textLines = note.lines.filter((line) => line.kind === "text");
  const dataLines = note.lines.filter((line) => line.kind === "data");

  return (
    <section>
      <h2 className="mb-3 text-[10px] uppercase tracking-wider text-zinc-700">
        {note.title}
      </h2>

      {textLines.length > 0 ? (
        <div className="space-y-2">
          {textLines.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-zinc-100">
              {line.value}
            </p>
          ))}
        </div>
      ) : null}

      {dataLines.length > 0 ? (
        <div className={`space-y-1 ${textLines.length > 0 ? "mt-4" : ""}`}>
          {dataLines.map((line, i) => (
            <p key={i} className="text-[13px] text-zinc-600">
              {line.value}
            </p>
          ))}
        </div>
      ) : null}
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

        <div className="space-y-10">
          {COMPANY_NOTES.map((note) => (
            <Section key={note.title} note={note} />
          ))}
        </div>
      </div>
    </div>
  );
}
