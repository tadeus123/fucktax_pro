"use client";

import { useCallback, useRef, useState } from "react";
import { formatDateRange, type VatFiling } from "@/lib/filings";
import { uploadFilingFiles } from "@/lib/upload";
import { UploadZone } from "./UploadZone";

type Zone = "document" | "bank";

export function VatFilingView({ filing }: { filing: VatFiling }) {
  const [documents, setDocuments] = useState<File[]>([]);
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [documentsStored, setDocumentsStored] = useState(0);
  const [bankStored, setBankStored] = useState(0);
  const [documentsUploading, setDocumentsUploading] = useState(false);
  const [bankUploading, setBankUploading] = useState(false);
  const [documentsProgress, setDocumentsProgress] = useState(0);
  const [bankProgress, setBankProgress] = useState(0);
  const [documentsError, setDocumentsError] = useState("");
  const [bankError, setBankError] = useState("");

  const docQueueRef = useRef<File[]>([]);
  const bankQueueRef = useRef<File[]>([]);
  const docRunningRef = useRef(false);
  const bankRunningRef = useRef(false);

  const ready = documentsStored > 0 && bankStored > 0;
  const periodRange = formatDateRange(filing.periodStart, filing.periodEnd);

  const runQueue = useCallback(
    async (zone: Zone) => {
      const isDoc = zone === "document";
      const queueRef = isDoc ? docQueueRef : bankQueueRef;
      const runningRef = isDoc ? docRunningRef : bankRunningRef;
      const setUploading = isDoc ? setDocumentsUploading : setBankUploading;
      const setProgress = isDoc ? setDocumentsProgress : setBankProgress;
      const setStored = isDoc ? setDocumentsStored : setBankStored;
      const setError = isDoc ? setDocumentsError : setBankError;

      if (runningRef.current) return;
      runningRef.current = true;

      while (queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0, queueRef.current.length);
        setUploading(true);
        setProgress(0);
        setError("");

        try {
          const result = await uploadFilingFiles(filing.id, zone, batch, ({ completed, total }) => {
            setProgress(total > 0 ? Math.round((completed / total) * 100) : 0);
          });
          setStored((count) => count + result.stored);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
          setUploading(false);
          setProgress(0);
        }
      }

      runningRef.current = false;
    },
    [filing.id],
  );

  function enqueueUpload(zone: Zone, files: File[]) {
    if (files.length === 0) return;
    if (zone === "document") {
      docQueueRef.current.push(...files);
      void runQueue("document");
      return;
    }
    bankQueueRef.current.push(...files);
    void runQueue("bank");
  }

  function handleDocuments(incoming: File[]) {
    const previousCount = documents.length;
    setDocuments(incoming);

    if (incoming.length === 0) {
      setDocumentsStored(0);
      setDocumentsError("");
      docQueueRef.current = [];
      return;
    }

    const toUpload = incoming.slice(previousCount);
    enqueueUpload("document", toUpload);
  }

  function handleBank(incoming: File[]) {
    const previousCount = bankFiles.length;
    setBankFiles(incoming);

    if (incoming.length === 0) {
      setBankStored(0);
      setBankError("");
      bankQueueRef.current = [];
      return;
    }

    const toUpload = incoming.slice(previousCount);
    enqueueUpload("bank", toUpload);
  }

  const documentsStarted = documentsStored > 0 || documentsUploading;
  const bankHighlighted = documentsStarted && bankStored === 0 && !bankUploading;

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
          uploading={documentsUploading}
          progress={documentsProgress}
          highlighted={!documentsStarted}
          onFilesSelected={handleDocuments}
          addMoreLabel="drop here to add more"
        />
        <UploadZone
          title="Bank"
          hint="bank export · all transactions in the period"
          accept=".csv,.pdf,.xlsx,.xls,.txt,.ofx,.qif,.xml,.zip"
          uploadKind="bank"
          files={bankFiles}
          storedCount={bankStored}
          uploading={bankUploading}
          progress={bankProgress}
          highlighted={bankHighlighted}
          onFilesSelected={handleBank}
          addMoreLabel="drop here to add more"
        />
      </div>

      {documentsError ? (
        <p className="mt-6 text-sm text-red-500">Documents: {documentsError}</p>
      ) : null}
      {bankError ? (
        <p className="mt-2 text-sm text-red-500">Bank: {bankError}</p>
      ) : null}

      {ready ? (
        <button
          type="button"
          className="mt-12 rounded-full bg-white px-8 py-3 text-sm font-medium text-black transition hover:bg-zinc-200"
        >
          Continue
        </button>
      ) : (
        <p className="mt-12 h-11 text-sm text-zinc-700">
          {documentsUploading || bankUploading
            ? "uploads run in the background — you can fill both sides"
            : documentsStored === 0
              ? "upload documents first"
              : bankStored === 0
                ? "then upload bank extract"
                : null}
        </p>
      )}
    </div>
  );
}
