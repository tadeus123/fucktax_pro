"use client";

import { renderMarkdownInline } from "@/lib/markdown-inline";
import type { FilingTodoItem } from "@/lib/filing-todos";

export function FilingTodoPanel({
  items,
  deletingId,
  onDelete,
}: {
  items: FilingTodoItem[];
  deletingId: string | null;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <aside className="flex w-52 shrink-0 flex-col border-l border-zinc-900 px-4 py-5">
      <p className="mb-4 text-[11px] uppercase tracking-wide text-zinc-600">todo</p>
      <ul className="no-scrollbar flex-1 space-y-4 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="group relative pr-4">
            <p className="text-[12px] leading-snug text-zinc-400">
              {renderMarkdownInline(item.text, "font-medium text-zinc-300")}
            </p>
            <button
              type="button"
              disabled={deletingId === item.id}
              onClick={() => onDelete(item.id)}
              className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center text-[13px] leading-none text-zinc-600 opacity-0 transition hover:text-zinc-300 group-hover:opacity-100 disabled:opacity-40"
              title="Remove"
              aria-label="Remove todo"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
