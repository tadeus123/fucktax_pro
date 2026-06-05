"use client";

import { useState } from "react";
import { logClientChatEvent } from "@/lib/chat-logger-client";
import { VatAssistantChat } from "@/components/VatAssistantChat";
import type { ReviewData } from "@/lib/supabase/queries";

export function ReviewView({
  data,
  filingPeriodId,
}: {
  data: ReviewData;
  filingRoute: string;
  filingPeriodId: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  async function downloadElster() {
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
        validationErrors?: string[];
        exportReady?: boolean;
      };
      if (!preview.ok) {
        const detail = previewBody.validationErrors?.join(" ") ?? previewBody.error ?? "Export failed";
        throw new Error(detail);
      }
      if (previewBody.exportReady === false) {
        throw new Error(previewBody.validationErrors?.join(" ") ?? "Export not ready");
      }

      void logClientChatEvent(filingPeriodId, "client_elster_download", "xml", {
        vatPayable: previewBody.vatPayable,
      });

      window.location.href = `/api/elster/export?filingPeriodId=${encodeURIComponent(filingPeriodId)}&format=xml`;
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-black">
      <header className="flex shrink-0 items-center justify-between px-6 py-4">
        <h1 className="text-[13px] text-zinc-500">{data.filingLabel}</h1>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void downloadElster()}
            className="text-[13px] text-zinc-400 transition hover:text-white disabled:opacity-40"
          >
            {exporting ? "…" : "ELSTER XML"}
          </button>
          <p className="max-w-xs text-right text-[11px] text-zinc-600">
            Mein ELSTER import only — upload XML, check fields, do not submit until reviewed.
          </p>
        </div>
      </header>

      {exportError ? (
        <p className="shrink-0 px-6 pb-2 text-[13px] text-red-400">{exportError}</p>
      ) : null}

      <div className="min-h-0 flex-1">
        <VatAssistantChat filingPeriodId={filingPeriodId} />
      </div>
    </div>
  );
}
