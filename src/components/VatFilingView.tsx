"use client";

import { useState } from "react";
import { formatDateRange, type VatFiling } from "@/lib/filings";
import { uploadFilingFiles } from "@/lib/upload";
import { UploadZone } from "./UploadZone";

export function VatFilingView({ filing }: { filing: VatFiling }) {
  const [documents, setDocuments] = useState<File[]>([]);
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [documentsStored, setDocumentsStored] = useState(0);
  const [bankStored, setBankStored] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const docsDone = documentsStored > 0;
  const bankDone = bankStored > 0;
  const ready = docsDone && bankDone;
  const periodRange = formatDateRange(filing.periodStart, filing.periodEnd);

  async function handleDocuments(incoming: File[]) {
    setUploadError("");
    const previousCount = documents.length;
    setDocuments(incoming);

    const toUpload = incoming.slice(previousCount);
    if (toUpload.length === 0) {
      if (incoming.length === 0) setDocumentsStored(0);
      return;
    }

    setUploading(true);
    try {
      const result = await uploadFilingFiles(filing.id, "document", toUpload);
      setDocumentsStored((count) => count + result.stored);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleBank(incoming: File[]) {
    setUploadError("");
    const previousCount = bankFiles.length;
    setBankFiles(incoming);

    const toUpload = incoming.slice(previousCount);
    if (toUpload.length === 0) {
      if (incoming.length === 0) setBankStored(0);
      return;
    }

    setUploading(true);
    try {
      const result = await uploadFilingFiles(filing.id, "bank", toUpload);
      setBankStored((count) => count + result.stored);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
          hint="invoices · receipts · customs · anything relevant"
          uploadKind="document"
          allowFolder
          files={documents}
          storedCount={documentsStored}
          onFilesSelected={handleDocuments}
          active={!docsDone && !uploading}
          done={docsDone}
        />
        <UploadZone
          title="Bank"
          hint="bank export · all transactions in the period"
          accept=".csv,.pdf,.xlsx,.xls,.txt,.ofx,.qif,.xml,.zip"
          uploadKind="bank"
          files={bankFiles}
          storedCount={bankStored}
          onFilesSelected={handleBank}
          active={docsDone && !bankDone && !uploading}
          done={bankDone}
        />
      </div>

      {uploadError ? (
        <p className="mt-8 text-sm text-red-500">{uploadError}</p>
      ) : ready ? (
        <button
          type="button"
          className="mt-12 rounded-full bg-white px-8 py-3 text-sm font-medium text-black transition hover:bg-zinc-200"
        >
          Continue
        </button>
      ) : (
        <p className="mt-12 h-11 text-sm text-zinc-700">
          {uploading
            ? "uploading & processing…"
            : !docsDone
              ? "upload documents first"
              : "then upload bank extract"}
        </p>
      )}
    </div>
  );
}
