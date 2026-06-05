"use client";

import { renderMarkdownInline } from "@/lib/markdown-inline";
import type { FilingTodoItem } from "@/lib/filing-todos";

export function FilingTodoPanel({
  items,
  uploadingId,
  resolvingId,
  onUpload,
  onNotFound,
  onDone,
}: {
  items: FilingTodoItem[];
  uploadingId: string | null;
  resolvingId: string | null;
  onUpload: (id: string) => void;
  onNotFound: (id: string) => void;
  onDone: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <aside className="flex w-52 shrink-0 flex-col border-l border-zinc-900 px-4 py-5">
      <p className="mb-4 text-[11px] uppercase tracking-wide text-zinc-600">todo</p>
      <ul className="no-scrollbar flex-1 space-y-4 overflow-y-auto">
        {items.map((item) => {
          const busy = uploadingId === item.id || resolvingId === item.id;
          const isRecovery = item.kind === "invoice_recovery";

          return (
            <li key={item.id} className="space-y-2">
              <p className="text-[12px] leading-snug text-zinc-400">
                {renderMarkdownInline(item.text, "font-medium text-zinc-300")}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {isRecovery ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUpload(item.id)}
                    className="text-[11px] text-zinc-500 transition hover:text-white disabled:opacity-40"
                  >
                    {uploadingId === item.id ? "…" : "upload"}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDone(item.id)}
                  className="text-[11px] text-zinc-500 transition hover:text-white disabled:opacity-40"
                >
                  done
                </button>
                {isRecovery ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onNotFound(item.id)}
                    className="text-[11px] text-zinc-700 transition hover:text-zinc-400 disabled:opacity-40"
                    title="Mark as not found"
                  >
                    not found
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
