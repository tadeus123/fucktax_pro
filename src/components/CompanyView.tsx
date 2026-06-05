import type { CompanyContent } from "@/lib/supabase/queries";

function Section({
  title,
  textLines,
  dataLines,
}: {
  title: string;
  textLines: string[];
  dataLines: string[];
}) {
  return (
    <section>
      <h2 className="mb-3 text-[10px] uppercase tracking-wider text-zinc-700">{title}</h2>

      {textLines.length > 0 ? (
        <div className="space-y-2">
          {textLines.map((line) => (
            <p key={line} className="text-sm leading-relaxed text-zinc-100">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {dataLines.length > 0 ? (
        <div className={`space-y-1 ${textLines.length > 0 ? "mt-4" : ""}`}>
          {dataLines.map((line) => (
            <p key={line} className="text-[13px] text-zinc-600">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function CompanyView({ content }: { content: CompanyContent }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl px-2">
        <header className="mb-12 text-center">
          <h1 className="text-2xl font-medium tracking-tight text-white">{content.name}</h1>
          <p className="mt-2 text-sm text-zinc-600">{content.tagline}</p>
        </header>

        <div className="space-y-10">
          {content.notes.map((note) => (
            <Section
              key={note.title}
              title={note.title}
              textLines={note.lines.filter((l) => l.kind === "text").map((l) => l.value)}
              dataLines={note.lines.filter((l) => l.kind === "data").map((l) => l.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
