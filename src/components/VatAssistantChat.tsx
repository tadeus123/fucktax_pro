"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { logClientChatEvent } from "@/lib/chat-logger-client";
import { uploadFilingFiles } from "@/lib/upload";

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
};

function visibleMessages(messages: ChatMessage[]): ChatMessage[] {
  const firstUserIndex = messages.findIndex((m) => m.role === "user");
  if (firstUserIndex === -1) return [];
  return messages.slice(firstUserIndex);
}

function renderMarkdownLite(text: string): ReactNode {
  const lines = text.split("\n");
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

  function renderInline(part: string): ReactNode {
    const segments = part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return segments.map((seg, i) => {
      if (seg.startsWith("**") && seg.endsWith("**")) {
        return (
          <strong key={i} className="font-medium text-zinc-100">
            {seg.slice(2, -2)}
          </strong>
        );
      }
      if (seg.startsWith("`") && seg.endsWith("`")) {
        return (
          <code key={i} className="rounded bg-zinc-800 px-1 text-[12px]">
            {seg.slice(1, -1)}
          </code>
        );
      }
      return seg;
    });
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
    nodes.push(
      <p key={`p-${li}`} className={nodes.length > 0 ? "mt-3" : undefined}>
        {renderInline(line)}
      </p>,
    );
  }
  if (inTable) flushTable();
  return nodes;
}

export function VatAssistantChat({
  filingPeriodId,
  onElsterUpdated,
}: {
  filingPeriodId: string;
  onElsterUpdated?: (info: { vatPayable: number }) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const displayMessages = visibleMessages(messages);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/vat-assistant?filingPeriodId=${encodeURIComponent(filingPeriodId)}`,
        );
        const body = (await response.json()) as {
          error?: string;
          messages?: ChatMessage[];
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Could not load assistant");
        }
        setMessages(body.messages ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [filingPeriodId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, sending]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

    try {
      const response = await fetch("/api/vat-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filingPeriodId, message: trimmed }),
      });
      const body = (await response.json()) as {
        error?: string;
        reply?: string;
        elsterUpdated?: boolean;
        vatPayable?: number;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Send failed");
      }
      setMessages((prev) => [...prev, { role: "assistant", content: body.reply ?? "" }]);
      if (body.elsterUpdated && body.vatPayable != null) {
        onElsterUpdated?.({ vatPayable: body.vatPayable });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleChatUpload(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList?.length || uploading || sending) return;

    const files = Array.from(fileList);
    event.target.value = "";

    const bankExt = /\.(csv|xlsx|xls|ofx|qif|mt940|sta)$/i;
    const bankFiles = files.filter((f) => bankExt.test(f.name));
    const docFiles = files.filter((f) => !bankExt.test(f.name));

    setUploading(true);
    setError("");
    void logClientChatEvent(filingPeriodId, "client_upload", `${files.length} file(s)`, {
      documentCount: docFiles.length,
      bankCount: bankFiles.length,
    });

    try {
      let stored = 0;
      if (docFiles.length > 0) {
        const r = await uploadFilingFiles(filingPeriodId, "document", docFiles);
        stored += r.stored;
      }
      if (bankFiles.length > 0) {
        const r = await uploadFilingFiles(filingPeriodId, "bank", bankFiles);
        stored += r.stored;
      }

      if (docFiles.length > 0) {
        await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filingPeriodId, incremental: true }),
        });
      }

      const userMsg = `Uploaded ${stored} file(s). Process and update ELSTER.`;
      await sendMessage(userMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {!loading ? (
          <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
            {displayMessages.map((msg, index) => (
              <div
                key={msg.id ?? index}
                className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                {msg.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[14px] leading-relaxed text-black">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[92%] text-[14px] leading-relaxed text-zinc-300">
                    {renderMarkdownLite(msg.content)}
                  </div>
                )}
              </div>
            ))}
            {sending || uploading ? (
              <p className="text-[13px] text-zinc-600">{uploading ? "Uploading…" : "…"}</p>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : null}
      </div>

      {error ? <p className="px-6 pb-2 text-[13px] text-red-400">{error}</p> : null}

      <div className="shrink-0 px-6 pb-6 pt-2">
        <form
          className="mx-auto flex max-w-2xl items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleChatUpload(e)}
          />
          <button
            type="button"
            disabled={loading || sending || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-600 transition hover:text-zinc-400 disabled:opacity-40"
            title="Add files"
          >
            +
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message"
            disabled={loading || sending || uploading}
            className="h-9 flex-1 border-b border-zinc-800 bg-transparent px-1 text-[14px] text-white outline-none placeholder:text-zinc-700 focus:border-zinc-600 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={loading || sending || uploading || !input.trim()}
            className="text-[13px] text-zinc-500 transition hover:text-white disabled:opacity-30"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
