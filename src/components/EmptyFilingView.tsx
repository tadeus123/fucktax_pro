import type { GenericFiling } from "@/lib/filings";

export function EmptyFilingView({
  filing,
  comingSoonLabel,
}: {
  filing: GenericFiling;
  comingSoonLabel: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-800 px-8 py-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {comingSoonLabel}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">{filing.label}</h1>
        <p className="mt-2 text-sm text-zinc-400">{filing.description}</p>
        <p className="mt-1 text-sm text-zinc-500">
          {filing.periodLabel} · {filing.deadlineLabel}
        </p>
      </header>

      <div className="flex flex-1 items-center justify-center px-8 py-16">
        <div className="max-w-md rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 px-8 py-12 text-center">
          <p className="text-4xl">🚧</p>
          <h2 className="mt-4 text-lg font-semibold text-zinc-200">Not built yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Only VAT filings are active in this MVP. Select a quarter under{" "}
            <span className="text-zinc-300">VAT filings</span> in the sidebar to upload documents
            and bank data.
          </p>
        </div>
      </div>
    </div>
  );
}
