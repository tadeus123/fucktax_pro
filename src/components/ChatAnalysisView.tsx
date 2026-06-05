"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatAnalysisReport } from "@/lib/chat-analysis";

type FilingOption = { id: string; label: string };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-zinc-900 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-700">{label}</p>
      <p className="mt-1 text-lg tabular-nums text-white">{value}</p>
    </div>
  );
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-zinc-400">{label}</span>
        <span className="shrink-0 tabular-nums text-zinc-600">{count}</span>
      </div>
      <div className="h-1 rounded-full bg-zinc-900">
        <div className="h-1 rounded-full bg-zinc-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ChatAnalysisView({ filings }: { filings: FilingOption[] }) {
  const [filingPeriodId, setFilingPeriodId] = useState("");
  const [report, setReport] = useState<ChatAnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ analysis: "1" });
      if (filingPeriodId) params.set("filingPeriodId", filingPeriodId);
      const res = await fetch(`/api/chat-analytics?${params.toString()}`);
      const body = (await res.json()) as ChatAnalysisReport & { error?: string; hint?: string };
      if (!res.ok) {
        throw new Error(body.hint ? `${body.error} — ${body.hint}` : body.error ?? "Load failed");
      }
      setReport(body);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [filingPeriodId]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxIntent = report?.intents[0]?.count ?? 1;
  const maxTool = report?.toolUsage[0]?.count ?? 1;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-white">Chat analysis</h1>
          <p className="mt-1 text-[13px] text-zinc-600">
            VAT assistant interactions — tools, errors, intents, product fixes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filingPeriodId}
            onChange={(e) => setFilingPeriodId(e.target.value)}
            className="rounded border border-zinc-800 bg-black px-3 py-1.5 text-[13px] text-zinc-400"
          >
            <option value="">All filings</option>
            {filings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[13px] text-zinc-500 hover:text-white"
          >
            refresh
          </button>
        </div>
      </header>

      {loading ? <p className="text-[13px] text-zinc-600">Loading…</p> : null}
      {error ? <p className="text-[13px] text-red-400">{error}</p> : null}

      {report && !loading ? (
        <div className="space-y-12">
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Turns" value={report.overview.totalTurns} />
            <Stat label="Success rate" value={`${report.overview.successRatePct}%`} />
            <Stat label="Avg response" value={`${(report.overview.avgResponseMs / 1000).toFixed(1)}s`} />
            <Stat label="Tool calls" value={report.overview.toolCalls} />
            <Stat label="ELSTER updates" value={report.overview.elsterUpdates} />
            <Stat label="Failed turns" value={report.overview.failedTurns} />
            <Stat label="XML downloads" value={report.overview.clientDownloads} />
            <Stat label="Events logged" value={report.overview.totalEvents} />
          </section>

          {report.recommendations.length > 0 ? (
            <section>
              <h2 className="mb-4 text-[10px] uppercase tracking-wider text-zinc-700">
                Recommendations
              </h2>
              <ul className="space-y-3">
                {report.recommendations.map((rec) => (
                  <li key={rec} className="text-[13px] leading-relaxed text-zinc-300">
                    {rec}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="grid gap-10 sm:grid-cols-2">
            <section>
              <h2 className="mb-4 text-[10px] uppercase tracking-wider text-zinc-700">
                User intents
              </h2>
              <div className="space-y-4">
                {report.intents.map((row) => (
                  <BarRow key={row.intent} label={row.intent} count={row.count} max={maxIntent} />
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-4 text-[10px] uppercase tracking-wider text-zinc-700">
                Tool usage
              </h2>
              <div className="space-y-4">
                {report.toolUsage.length > 0 ? (
                  report.toolUsage.map((row) => (
                    <BarRow key={row.tool} label={row.tool} count={row.count} max={maxTool} />
                  ))
                ) : (
                  <p className="text-[13px] text-zinc-600">No tool calls yet.</p>
                )}
              </div>
            </section>
          </div>

          {report.errors.length > 0 ? (
            <section>
              <h2 className="mb-4 text-[10px] uppercase tracking-wider text-zinc-700">Errors</h2>
              <div className="space-y-4">
                {report.errors.map((row) => (
                  <div key={row.message} className="rounded border border-zinc-900 px-4 py-3">
                    <p className="text-[13px] text-red-400">
                      {row.message}{" "}
                      <span className="text-zinc-600">×{row.count}</span>
                    </p>
                    {row.examples.length > 0 ? (
                      <p className="mt-2 text-[12px] text-zinc-600">
                        e.g. “{row.examples[0]}”
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {report.byFiling.length > 1 ? (
            <section>
              <h2 className="mb-4 text-[10px] uppercase tracking-wider text-zinc-700">
                By filing
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="text-zinc-700">
                      <th className="pb-2 pr-4 font-normal">Filing</th>
                      <th className="pb-2 pr-4 font-normal">Turns</th>
                      <th className="pb-2 pr-4 font-normal">Errors</th>
                      <th className="pb-2 pr-4 font-normal">ELSTER</th>
                      <th className="pb-2 font-normal">Avg ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byFiling.map((row) => (
                      <tr key={row.id} className="border-t border-zinc-900 text-zinc-400">
                        <td className="py-2 pr-4 text-zinc-300">{row.label}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.turns}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.errors}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.elsterUpdates}</td>
                        <td className="py-2 tabular-nums">{row.avgDurationMs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-4 text-[10px] uppercase tracking-wider text-zinc-700">
              Recent turns
            </h2>
            <div className="space-y-4">
              {report.recentTurns.map((turn) => (
                <article
                  key={turn.turnId}
                  className="rounded border border-zinc-900 px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[11px] text-zinc-600">
                      {turn.filingLabel} · {turn.startedAt.slice(0, 16).replace("T", " ")}
                    </span>
                    <span className="text-[11px] tabular-nums text-zinc-700">
                      {turn.durationMs != null ? `${(turn.durationMs / 1000).toFixed(1)}s` : "—"} ·{" "}
                      {turn.toolCalls} tools
                      {turn.elsterUpdated ? " · ELSTER" : ""}
                      {!turn.success ? " · failed" : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-white">{turn.userMessage}</p>
                  <p className="mt-1 text-[13px] text-zinc-500">{turn.assistantPreview}</p>
                  {turn.error ? (
                    <p className="mt-2 text-[12px] text-red-400">{turn.error}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <p className="text-[11px] text-zinc-700">
            Exported {report.exportedAt.slice(0, 19).replace("T", " ")} UTC · run{" "}
            <code className="text-zinc-600">npm run inspect:chats</code> for raw JSON
          </p>
        </div>
      ) : null}
    </div>
  );
}
