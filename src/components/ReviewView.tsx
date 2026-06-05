import Link from "next/link";
import type { ReviewData } from "@/lib/supabase/queries";

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function confidenceClass(confidence: string | null): string {
  if (confidence === "safe") return "text-zinc-400";
  if (confidence === "likely") return "text-yellow-500";
  return "text-red-400";
}

export function ReviewView({ data, filingRoute }: { data: ReviewData; filingRoute: string }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-600">Review</p>
          <h1 className="text-3xl font-medium tracking-tight text-white">{data.filingLabel}</h1>
          <p className="mt-1 text-sm text-zinc-600">{data.periodRange}</p>
        </div>
        <Link href={`/vat/${filingRoute}`} className="text-sm text-zinc-500 hover:text-zinc-300">
          ← uploads
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Documents", data.stats.documents],
          ["Bank lines", data.stats.bankLines],
          ["Matched", data.stats.matched],
          ["Needs review", data.stats.needsReview],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-900 px-4 py-3">
            <p className="text-[11px] text-zinc-600">{label}</p>
            <p className="text-xl text-white">{value}</p>
          </div>
        ))}
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm text-zinc-400">Documents</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-900">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-zinc-900 text-[11px] text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-normal">File</th>
                <th className="px-4 py-3 font-normal">Type</th>
                <th className="px-4 py-3 font-normal">Counterparty</th>
                <th className="px-4 py-3 font-normal">Date</th>
                <th className="px-4 py-3 font-normal">Gross</th>
                <th className="px-4 py-3 font-normal">VAT</th>
                <th className="px-4 py-3 font-normal">Bank</th>
                <th className="px-4 py-3 font-normal">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {data.documents.map((doc) => (
                <tr key={doc.id} className="border-b border-zinc-900/80 text-zinc-300">
                  <td className="max-w-[180px] truncate px-4 py-3" title={doc.filename}>
                    {doc.filename.split("/").pop()}
                  </td>
                  <td className="px-4 py-3">{doc.documentType ?? "—"}</td>
                  <td className="px-4 py-3">{doc.counterparty ?? "—"}</td>
                  <td className="px-4 py-3">{doc.invoiceDate ?? "—"}</td>
                  <td className="px-4 py-3">{formatMoney(doc.grossAmount)}</td>
                  <td className="px-4 py-3">
                    {doc.vatRate != null ? `${doc.vatRate}%` : "—"}
                    {doc.vatAmount != null ? ` · ${formatMoney(doc.vatAmount)}` : ""}
                  </td>
                  <td className="px-4 py-3">{doc.matched ? "✓" : "—"}</td>
                  <td className={`px-4 py-3 ${confidenceClass(doc.confidence)}`}>
                    {doc.confidence ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.unmatchedBank.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm text-zinc-400">Unmatched bank lines</h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-900">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="border-b border-zinc-900 text-[11px] text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-normal">Date</th>
                  <th className="px-4 py-3 font-normal">Amount</th>
                  <th className="px-4 py-3 font-normal">Description</th>
                  <th className="px-4 py-3 font-normal">Counterparty</th>
                </tr>
              </thead>
              <tbody>
                {data.unmatchedBank.slice(0, 30).map((line) => (
                  <tr key={line.id} className="border-b border-zinc-900/80 text-zinc-300">
                    <td className="px-4 py-3">{line.date}</td>
                    <td className="px-4 py-3">{formatMoney(line.amount)}</td>
                    <td className="px-4 py-3">{line.description ?? "—"}</td>
                    <td className="px-4 py-3">{line.counterparty ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.unmatchedBank.length > 30 ? (
              <p className="px-4 py-2 text-[11px] text-zinc-600">
                + {data.unmatchedBank.length - 30} more unmatched lines
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
