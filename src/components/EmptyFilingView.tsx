import type { GenericFiling } from "@/lib/filings";

export function EmptyFilingView({ filing }: { filing: GenericFiling }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-zinc-700">soon</p>
    </div>
  );
}
