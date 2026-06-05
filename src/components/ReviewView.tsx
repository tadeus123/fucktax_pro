"use client";

import Link from "next/link";
import { useState } from "react";
import { logClientChatEvent } from "@/lib/chat-logger-client";
import { VatAssistantChat } from "@/components/VatAssistantChat";
import type { ReviewData } from "@/lib/supabase/queries";

function formatEuro(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

export function ReviewView({
  data,
  filingRoute,
  filingPeriodId,
}: {
  data: ReviewData;
  filingRoute: string;
  filingPeriodId: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<{
    vatPayable: number;
    warnings: string[];
  } | null>(null);
  const [exportError, setExportError] = useState("");

  async function downloadElster(format: "xml" | "csv") {
    setExporting(true);
    setExportError("");
    try {
      const preview = await fetch("/api/elster/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filingPeriodId }),
      });
      const previewBody = (await preview.json()) as {
        error?: string;
        vatPayable?: number;
        warnings?: string[];
      };
      if (!preview.ok) {
        throw new Error(previewBody.error ?? "Export failed");
      }
      setExportInfo({
        vatPayable: previewBody.vatPayable ?? 0,
        warnings: previewBody.warnings ?? [],
      });

      void logClientChatEvent(filingPeriodId, "client_elster_download", format, {
        vatPayable: previewBody.vatPayable,
      });

      window.location.href = `/api/elster/export?filingPeriodId=${encodeURIComponent(filingPeriodId)}&format=${format}`;
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm text-white">{data.filingLabel}</p>
          <p className="text-[11px] text-zinc-600">
            {data.periodRange} · dedicated chat · use + to add files
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/vat/${filingRoute}`}
            className="text-[12px] text-zinc-500 hover:text-zinc-300"
          >
            uploads
          </Link>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void downloadElster("xml")}
            className="rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-zinc-200 disabled:opacity-40"
          >
            {exporting ? "building…" : "Download ELSTER XML"}
          </button>
        </div>
      </header>

      {exportError ? (
        <p className="shrink-0 px-4 py-2 text-sm text-red-400">{exportError}</p>
      ) : null}

      {exportInfo ? (
        <div className="shrink-0 border-b border-zinc-900 bg-zinc-950 px-4 py-2 text-[12px] text-zinc-400 sm:px-6">
          Estimated VAT payable:{" "}
          <span className="text-white">{formatEuro(exportInfo.vatPayable)}</span>
          {exportInfo.warnings.length > 0 ? (
            <span className="text-zinc-600"> · {exportInfo.warnings.length} notes — check in ELSTER before send</span>
          ) : null}
        </div>
      ) : (
        <div className="shrink-0 border-b border-zinc-900 bg-zinc-950 px-4 py-2 text-[12px] text-zinc-500 sm:px-6">
          Talk in plain language below — the AI applies fixes automatically. Then{" "}
          <strong className="text-zinc-300">Download ELSTER XML</strong> → Mein ELSTER → XML Import.
        </div>
      )}

      <div className="min-h-0 flex-1">
        <VatAssistantChat
          filingPeriodId={filingPeriodId}
          onElsterUpdated={({ vatPayable }) =>
            setExportInfo((prev) => ({
              vatPayable,
              warnings: prev?.warnings ?? [],
            }))
          }
        />
      </div>
    </div>
  );
}
