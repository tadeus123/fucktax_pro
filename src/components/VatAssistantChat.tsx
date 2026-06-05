"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { logClientChatEvent } from "@/lib/chat-logger-client";
import { uploadFilingFiles } from "@/lib/upload";

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
};

function renderMarkdownLite(text: string): ReactNode {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  function flushTable() {
    if (tableRows.length === 0) return;
    const [header, ...body] = tableRows;
    nodes.push(
      <div key={`table-${nodes.length}`} className="my-3 overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-zinc-700 text-zinc-500">
              {header.map((cell, i) => (
                <th key={i} className="px-2 py-1.5 font-normal">
                  {renderInline(cell.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="border-b border-zinc-800/80">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-2 py-1.5 text-zinc-300">
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
          <strong key={i} className="font-medium text-white">
            {seg.slice(2, -2)}
          </strong>
        );
      }
      if (seg.startsWith("`") && seg.endsWith("`")) {
        return (
          <code key={i} className="rounded bg-zinc-800 px-1 text-[11px]">
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
    if (line.trim() === "") {
      nodes.push(<br key={`br-${li}`} />);
      continue;
    }
    nodes.push(
      <p key={`p-${li}`} className={li > 0 ? "mt-2" : undefined}>
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
  }, [messages, sending]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    void logClientChatEvent(filingPeriodId, "client_quick_prompt", trimmed);

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
      filenames: files.map((f) => f.name).slice(0, 20),
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

      const userMsg = `I just uploaded ${stored} file(s) to this quarter. Process them and update ELSTER.`;
      setMessages((prev) => [...prev, { role: "user", content: userMsg }]);

      const response = await fetch("/api/vat-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filingPeriodId, message: userMsg }),
      });
      const body = (await response.json()) as {
        error?: string;
        reply?: string;
        vatPayable?: number;
        elsterUpdated?: boolean;
      };
      if (!response.ok) throw new Error(body.error ?? "Upload follow-up failed");
      setMessages((prev) => [...prev, { role: "assistant", content: body.reply ?? "" }]);
      if (body.elsterUpdated && body.vatPayable != null) {
        onElsterUpdated?.({ vatPayable: body.vatPayable });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const quickPrompts = [
    "Just make it work — clean up and build ELSTER",
    "Most payments have no invoice — file cleanly",
    "Yes, ignore wallet transfers",
    "Cursor and Notion are reverse charge",
  ];

  async function runSmartDefaults() {
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/vat-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filingPeriodId, action: "smart_defaults" }),
      });
      const body = (await response.json()) as {
        error?: string;
        reply?: string;
        vatPayable?: number;
      };
      if (!response.ok) throw new Error(body.error ?? "Failed");
      setMessages((prev) => [
        ...prev,
        { role: "user", content: "Just make it work — clean up and build ELSTER" },
        { role: "assistant", content: body.reply ?? "" },
      ]);
      if (body.vatPayable != null) onElsterUpdated?.({ vatPayable: body.vatPayable });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {loading ? (
          <p className="mx-auto max-w-2xl text-sm text-zinc-600">Loading…</p>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5 pb-4">
            {messages.map((msg, index) => (
              <div
                key={msg.id ?? index}
                className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    msg.role === "user"
                      ? "max-w-[88%] rounded-2xl rounded-br-sm bg-white px-4 py-2.5 text-[14px] leading-relaxed text-black"
                      : "max-w-[100%] text-[14px] leading-relaxed text-zinc-300"
                  }
                >
                  {msg.role === "assistant" ? renderMarkdownLite(msg.content) : msg.content}
                </div>
              </div>
            ))}
            {sending || uploading ? (
              <p className="text-sm text-zinc-600">{uploading ? "Uploading…" : "Thinking…"}</p>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error ? (
        <p className="mx-auto max-w-2xl px-4 pb-2 text-sm text-red-400">{error}</p>
      ) : null}

      {!loading ? (
        <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2 px-4 pb-3">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={sending}
              onClick={() =>
                prompt.startsWith("Just make it work")
                  ? void runSmartDefaults()
                  : void sendMessage(prompt)
              }
              className="rounded-full border border-zinc-800 px-3 py-1.5 text-[12px] text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="border-t border-zinc-900 bg-black p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
      >
        <div className="mx-auto flex max-w-2xl gap-2">
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
            className="shrink-0 rounded-xl border border-zinc-800 px-3 py-3 text-[12px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-40"
            title="Upload documents or bank files to this filing"
          >
            +
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell me what to exclude, confirm, or fix — I update ELSTER for you…"
            disabled={loading || sending || uploading}
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={loading || sending || uploading || !input.trim()}
            className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-black disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
