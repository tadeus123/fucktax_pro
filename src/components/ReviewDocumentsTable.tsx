"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReviewDocument } from "@/lib/supabase/queries";

function formatMoney(value: number | null): string {
  if (value == null) return "";
  return String(value);
}

export function ReviewDocumentsTable({
  documents: initialDocuments,
  filingPeriodId,
}: {
  documents: ReviewDocument[];
  filingPeriodId: string;
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [rematching, setRematching] = useState(false);

  async function rematch() {
    setRematching(true);
    try {
      const response = await fetch("/api/process/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filingPeriodId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Re-match failed");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Re-match failed");
    } finally {
      setRematching(false);
    }
  }

  async function saveRow(doc: ReviewDocument) {
    setSavingId(doc.id);
    try {
      const response = await fetch(`/api/document-records/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: doc.documentType,
          counterparty_name: doc.counterparty,
          invoice_date: doc.invoiceDate || null,
          gross_amount: doc.grossAmount != null ? Number(doc.grossAmount) : null,
          vat_rate: doc.vatRate != null ? Number(doc.vatRate) : null,
          vat_amount: doc.vatAmount != null ? Number(doc.vatAmount) : null,
          confidence: doc.confidence,
          warning: doc.warning,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Save failed");
      }
    } finally {
      setSavingId(null);
    }
  }

  function updateDoc(id: string, patch: Partial<ReviewDocument>) {
    setDocuments((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function reprocess() {
    setReprocessing(true);
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filingPeriodId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Reprocess failed");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reprocess failed");
    } finally {
      setReprocessing(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm text-zinc-400">Documents — click a cell to edit, blur to save</h2>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={rematching}
            onClick={rematch}
            className="text-[11px] text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300 disabled:opacity-40"
          >
            {rematching ? "matching…" : "re-match bank"}
          </button>
          <button
            type="button"
            disabled={reprocessing}
            onClick={reprocess}
            className="text-[11px] text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300 disabled:opacity-40"
          >
            {reprocessing ? "reprocessing…" : "re-run AI"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-900">
        <table className="w-full min-w-[900px] text-left text-[13px]">
          <thead className="border-b border-zinc-900 text-[11px] text-zinc-600">
            <tr>
              <th className="px-3 py-3 font-normal">File</th>
              <th className="px-3 py-3 font-normal">Type</th>
              <th className="px-3 py-3 font-normal">Counterparty</th>
              <th className="px-3 py-3 font-normal">Date</th>
              <th className="px-3 py-3 font-normal">Gross</th>
              <th className="px-3 py-3 font-normal">VAT %</th>
              <th className="px-3 py-3 font-normal">Bank</th>
              <th className="px-3 py-3 font-normal">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-b border-zinc-900/80 text-zinc-300">
                <td className="max-w-[140px] truncate px-3 py-2" title={doc.filename}>
                  {doc.filename.split("/").pop()}
                  {doc.warning ? (
                    <p className="truncate text-[10px] text-red-400/80">{doc.warning}</p>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full min-w-[100px] bg-transparent text-[13px] outline-none focus:text-white"
                    value={doc.documentType ?? ""}
                    onChange={(e) => updateDoc(doc.id, { documentType: e.target.value })}
                    onBlur={() => saveRow(documents.find((d) => d.id === doc.id)!)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full min-w-[120px] bg-transparent text-[13px] outline-none focus:text-white"
                    value={doc.counterparty ?? ""}
                    onChange={(e) => updateDoc(doc.id, { counterparty: e.target.value })}
                    onBlur={() => saveRow(documents.find((d) => d.id === doc.id)!)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-28 bg-transparent text-[13px] outline-none focus:text-white"
                    value={doc.invoiceDate ?? ""}
                    onChange={(e) => updateDoc(doc.id, { invoiceDate: e.target.value })}
                    onBlur={() => saveRow(documents.find((d) => d.id === doc.id)!)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-20 bg-transparent text-[13px] outline-none focus:text-white"
                    value={formatMoney(doc.grossAmount)}
                    onChange={(e) =>
                      updateDoc(doc.id, {
                        grossAmount: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    onBlur={() => saveRow(documents.find((d) => d.id === doc.id)!)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-14 bg-transparent text-[13px] outline-none focus:text-white"
                    value={doc.vatRate != null ? String(doc.vatRate) : ""}
                    onChange={(e) =>
                      updateDoc(doc.id, {
                        vatRate: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    onBlur={() => saveRow(documents.find((d) => d.id === doc.id)!)}
                  />
                </td>
                <td className="px-3 py-2">{doc.matched ? "✓" : "—"}</td>
                <td className="px-3 py-2">
                  <select
                    className="bg-transparent text-[13px] outline-none"
                    value={doc.confidence ?? "review"}
                    onChange={(e) => {
                      updateDoc(doc.id, { confidence: e.target.value });
                      saveRow({ ...doc, confidence: e.target.value });
                    }}
                  >
                    <option value="safe">safe</option>
                    <option value="likely">likely</option>
                    <option value="review">review</option>
                    <option value="do_not_deduct">skip</option>
                  </select>
                  {savingId === doc.id ? (
                    <span className="ml-1 text-[10px] text-zinc-600">…</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
