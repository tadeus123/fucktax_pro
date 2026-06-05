"use client";

import { useState } from "react";
import { formatDateRange, type VatFiling } from "@/lib/filings";
import { UploadZone } from "./UploadZone";

export function VatFilingView({ filing }: { filing: VatFiling }) {
  const [documents, setDocuments] = useState<File[]>([]);
  const [bankFiles, setBankFiles] = useState<File[]>([]);

  const docsDone = documents.length > 0;
  const bankDone = bankFiles.length > 0;
  const ready = docsDone && bankDone;
  const periodRange = formatDateRange(filing.periodStart, filing.periodEnd);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-medium tracking-tight text-white">
          <span className="text-zinc-600">VAT-Prefilling </span>
          {filing.label}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">{periodRange}</p>
      </div>

      <div className="flex w-full max-w-2xl flex-col gap-4 sm:flex-row sm:gap-6">
        <UploadZone
          title="Documents"
          hint="invoices · receipts · customs · PDFs"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.csv,.xlsx,.xls,.doc,.docx,.txt"
          files={documents}
          onFilesSelected={setDocuments}
          active={!docsDone}
          done={docsDone}
        />
        <UploadZone
          title="Bank"
          hint="bank export · CSV or PDF"
          accept=".csv,.pdf,.xlsx,.xls,.txt,.ofx,.qif"
          files={bankFiles}
          onFilesSelected={setBankFiles}
          active={docsDone && !bankDone}
          done={bankDone}
        />
      </div>

      {ready ? (
        <button
          type="button"
          className="mt-12 rounded-full bg-white px-8 py-3 text-sm font-medium text-black transition hover:bg-zinc-200"
        >
          Continue
        </button>
      ) : (
        <p className="mt-12 h-11 text-sm text-zinc-700">
          {!docsDone ? "upload documents first" : "then upload bank extract"}
        </p>
      )}
    </div>
  );
}
