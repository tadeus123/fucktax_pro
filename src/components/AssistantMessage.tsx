"use client";

import type { ReactNode } from "react";
import { renderMarkdownInline } from "@/lib/markdown-inline";
import { parseActionableLines, todoItemKey, type FilingTodoItem } from "@/lib/filing-todos";

function renderInline(part: string): ReactNode {
  return renderMarkdownInline(part);
}

export function AssistantMessage({
  content,
  todos,
  onAddTodo,
}: {
  content: string;
  todos: FilingTodoItem[];
  onAddTodo: (line: ReturnType<typeof parseActionableLines>[number]) => void;
}) {
  const actionable = parseActionableLines(content);
  const actionableByRaw = new Map(actionable.map((a) => [a.raw, a]));
  const todoKeys = new Set(todos.map((t) => todoItemKey(t)));

  const lines = content.split("\n");
  const nodes: ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  function flushTable() {
    if (tableRows.length === 0) return;
    const [header, ...body] = tableRows;
    nodes.push(
      <div key={`table-${nodes.length}`} className="my-2 overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50 text-zinc-500">
              {header.map((cell, i) => (
                <th key={i} className="px-3 py-2 font-normal">
                  {renderInline(cell.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="border-b border-zinc-800/60 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-zinc-300">
                    {renderInline(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
    inTable = false;
  }

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    if (line.trim().startsWith("|") && line.includes("|")) {
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      inTable = true;
      tableRows.push(
        line
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim()),
      );
      continue;
    }
    if (inTable) flushTable();
    if (line.trim() === "") continue;

    const action = actionableByRaw.get(line.trim());
    if (action) {
      const key = todoItemKey({
        vendor: action.vendor,
        pattern: action.pattern,
        text: action.display,
      });
      const inList = todoKeys.has(key);

      nodes.push(
        <div
          key={`action-${li}`}
          className={`flex items-start gap-3 ${nodes.length > 0 ? "mt-2" : ""}`}
        >
          <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-zinc-300">
            {renderInline(action.display)}
          </p>
          {inList ? (
            <span className="shrink-0 pt-0.5 text-[11px] text-zinc-700">in todo</span>
          ) : (
            <button
              type="button"
              onClick={() => onAddTodo(action)}
              className="shrink-0 pt-0.5 text-[11px] text-zinc-600 transition hover:text-zinc-300"
            >
              + todo
            </button>
          )}
        </div>,
      );
      continue;
    }

    nodes.push(
      <p key={`p-${li}`} className={nodes.length > 0 ? "mt-3" : undefined}>
        {renderInline(line)}
      </p>,
    );
  }

  if (inTable) flushTable();
  return <>{nodes}</>;
}
