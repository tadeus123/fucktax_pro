"use client";

import { useState } from "react";
import {
  BANK_UPLOAD_HINTS,
  DOCUMENT_UPLOAD_HINTS,
  formatDateRange,
  type VatFiling,
} from "@/lib/filings";
import { UploadZone } from "./UploadZone";

export function VatFilingView({ filing }: { filing: VatFiling }) {
  const [documents, setDocuments] = useState<File[]>([]);
  const [bankFiles, setBankFiles] = useState<File[]>([]);

  const periodRange = formatDateRange(filing.periodStart, filing.periodEnd);
  const totalFiles = documents.length + bankFiles.length;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-800 px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500">
              Umsatzsteuer-Voranmeldung
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white">
              VAT filing · {filing.label}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Upload everything for{" "}
              <span className="font-medium text-zinc-200">{periodRange}</span>. Invoices are the
              legal source; bank data is for reconciliation.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              ELSTER deadline
            </p>
            <p className="mt-0.5 text-sm font-semibold text-amber-300">{filing.deadlineLabel}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-sm text-zinc-300">
            <span className="font-medium text-white">Step 1 — Upload data.</span> Two uploads only:
            all documents on the left, bank extract on the right. AI classification and ELSTER XML
            come after the backend is connected.
          </p>
        </div>

        <div className="grid min-h-[520px] grid-cols-1 gap-6 lg:grid-cols-2">
          <UploadZone
            title="Documents & invoices"
            subtitle="Everything the AI needs to classify VAT — not just PDF invoices."
            periodLabel={`Period: ${periodRange}`}
            hints={DOCUMENT_UPLOAD_HINTS}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.csv,.xlsx,.xls,.doc,.docx,.txt"
            files={documents}
            onFilesSelected={setDocuments}
          />
          <UploadZone
            title="Bank account extract"
            subtitle="Transactions from your business account for the same period."
            periodLabel={`Transactions: ${periodRange}`}
            hints={BANK_UPLOAD_HINTS}
            accept=".csv,.pdf,.xlsx,.xls,.txt,.ofx,.qif"
            files={bankFiles}
            onFilesSelected={setBankFiles}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {totalFiles === 0
                ? "No files selected yet"
                : `${totalFiles} file${totalFiles === 1 ? "" : "s"} ready (${documents.length} documents · ${bankFiles.length} bank)`}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Upload is UI-only for now — Supabase + AI processing will be wired up next.
            </p>
          </div>
          <button
            type="button"
            disabled={totalFiles === 0}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue to review
          </button>
        </div>
      </div>
    </div>
  );
}
