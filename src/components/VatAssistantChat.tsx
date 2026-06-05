"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AssistantMessage } from "@/components/AssistantMessage";
import { ChatActivityIndicator } from "@/components/ChatActivityIndicator";
import { FilingTodoPanel } from "@/components/FilingTodoPanel";
import { logClientChatEvent } from "@/lib/chat-logger-client";
import {
  parsedLineToTodoInput,
  todoKeyForItem,
  todoKeyFromLine,
  type FilingTodoItem,
  type ParsedActionLine,
} from "@/lib/filing-todos";
import { uploadFilingFiles } from "@/lib/upload";

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
};

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

function isSupportedChatFile(name: string): boolean {
  return /\.(pdf|jpg|jpeg|png|heic|webp|zip|csv|xlsx|xls|ofx|qif|mt940|sta)$/i.test(name);
}

function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|heic|webp|gif)$/i.test(name);
}

function shortFileName(name: string, max = 28): string {
  if (name.length <= max) return name;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = name.slice(0, max - ext.length - 1);
  return `${base}…${ext}`;
}

function visibleMessages(messages: ChatMessage[]): ChatMessage[] {
  const firstUserIndex = messages.findIndex((m) => m.role === "user");
  if (firstUserIndex === -1) return [];
  return messages.slice(firstUserIndex);
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
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [todos, setTodos] = useState<FilingTodoItem[]>([]);
  const [deletingTodoId, setDeletingTodoId] = useState<string | null>(null);
  const [savingTodoKeys, setSavingTodoKeys] = useState<Set<string>>(new Set());
  const assistantBusyRef = useRef(false);
  const uploadingRef = useRef(false);

  const displayMessages = visibleMessages(messages);
  const showActivity = loading || sending || uploading || activity != null;
  const activityLabel =
    activity ??
    (loading ? "Loading chat…" : uploading ? "Uploading files…" : sending ? "Sending…" : null);

  const refreshTodos = useCallback(async (): Promise<FilingTodoItem[]> => {
    try {
      const response = await fetch(
        `/api/filing-todos?filingPeriodId=${encodeURIComponent(filingPeriodId)}`,
      );
      const body = (await response.json()) as { todos?: FilingTodoItem[]; error?: string };
      if (response.ok) {
        const next = body.todos ?? [];
        setTodos(next);
        return next;
      }
      if (body.error?.includes("filing_todos")) {
        setError("Run supabase/filing-todos.sql to enable persistent todos.");
      }
    } catch {
      /* network */
    }
    return [];
  }, [filingPeriodId]);

  useEffect(() => {
    void refreshTodos();
  }, [refreshTodos]);

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

  const addTodo = useCallback(
    async (line: ParsedActionLine) => {
      const key = todoKeyFromLine(line);
      if (savingTodoKeys.has(key) || todos.some((t) => todoKeyForItem(t) === key)) return;

      setSavingTodoKeys((prev) => new Set(prev).add(key));
      setError("");
      try {
        const response = await fetch("/api/filing-todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsedLineToTodoInput(line, filingPeriodId)),
        });
        const body = (await response.json()) as { todo?: FilingTodoItem; error?: string };
        if (!response.ok || !body.todo) {
          throw new Error(body.error ?? "Could not save todo");
        }
        await refreshTodos();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save todo");
      } finally {
        setSavingTodoKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [filingPeriodId, refreshTodos, savingTodoKeys, todos],
  );

  const deleteTodo = useCallback(
    async (id: string) => {
      setDeletingTodoId(id);
      setError("");
      try {
        const response = await fetch(`/api/filing-todos/${id}`, { method: "DELETE" });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(body.error ?? "Could not remove todo");
        }
        await refreshTodos();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove todo");
      } finally {
        setDeletingTodoId(null);
      }
    },
    [refreshTodos],
  );

  async function readStreamedAssistantResponse(response: Response): Promise<{
    reply: string;
    elsterUpdated?: boolean;
    vatPayable?: number;
  }> {
    if (!response.body) {
      throw new Error("Send failed");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type: string;
          message?: string;
          error?: string;
          reply?: string;
          elsterUpdated?: boolean;
          vatPayable?: number;
        };

        if (event.type === "status" && event.message) {
          setActivity(event.message);
        } else if (event.type === "error") {
          throw new Error(event.error ?? "Send failed");
        } else if (event.type === "done") {
          void refreshTodos();
          return {
            reply: event.reply ?? "",
            elsterUpdated: event.elsterUpdated,
            vatPayable: event.vatPayable,
          };
        }
      }
    }

    throw new Error("Assistant ended without a reply");
  }

  async function waitForAssistantIdle(maxMs = 120_000): Promise<void> {
    const started = Date.now();
    while (assistantBusyRef.current) {
      if (Date.now() - started > maxMs) {
        throw new Error("Assistant is still busy — try again in a moment.");
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async function runProcess(body: Record<string, unknown>): Promise<void> {
    const response = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Processing failed");
    }
  }

  async function postUserMessage(
    text: string,
    options?: { clearInput?: boolean; skipUserBubble?: boolean },
  ) {
    const trimmed = text.trim();
    if (!trimmed) return;

    await waitForAssistantIdle();
    assistantBusyRef.current = true;
    setSending(true);
    setActivity("Sending…");
    setError("");
    if (options?.clearInput !== false) setInput("");
    if (!options?.skipUserBubble) {
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    }

    try {
      const response = await fetch("/api/vat-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ filingPeriodId, message: trimmed, stream: true }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Send failed");
      }

      const body = await readStreamedAssistantResponse(response);
      setMessages((prev) => [...prev, { role: "assistant", content: body.reply }]);
      if (body.elsterUpdated && body.vatPayable != null) {
        onElsterUpdated?.({ vatPayable: body.vatPayable });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      assistantBusyRef.current = false;
      setSending(false);
      setActivity(null);
      inputRef.current?.focus();
    }
  }

  async function sendMessage(text: string, files: File[] = []) {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;

    if (files.length === 0) {
      await postUserMessage(trimmed);
      return;
    }

    const fileNames = files.map((f) => f.name);
    const attachLine = fileNames.join(", ");
    const userBubble = trimmed ? `${trimmed}\n\n${attachLine}` : attachLine;

    setMessages((prev) => [...prev, { role: "user", content: userBubble }]);

    const stored = await uploadAndProcessFiles(files);
    if (stored === null) return;

    const assistantMsg = trimmed || `Uploaded ${stored} file(s). Process and update ELSTER.`;
    await postUserMessage(assistantMsg, { clearInput: false, skipUserBubble: true });
  }

  async function uploadAndProcessFiles(files: File[]): Promise<number | null> {
    if (uploadingRef.current) {
      setError("Upload already in progress — wait for it to finish.");
      return null;
    }

    const bankExt = /\.(csv|xlsx|xls|ofx|qif|mt940|sta)$/i;
    const bankFiles = files.filter((f) => bankExt.test(f.name));
    const docFiles = files.filter((f) => !bankExt.test(f.name));

    if (docFiles.length === 0 && bankFiles.length === 0) {
      setError("No supported files selected (PDF, images, or bank CSV).");
      return null;
    }

    uploadingRef.current = true;
    setUploading(true);
    setActivity(`Uploading ${files.length} file(s)…`);
    setError("");
    void logClientChatEvent(filingPeriodId, "client_upload", `${files.length} file(s)`, {
      documentCount: docFiles.length,
      bankCount: bankFiles.length,
    });

    try {
      let stored = 0;
      if (docFiles.length > 0) {
        const r = await uploadFilingFiles(filingPeriodId, "document", docFiles, ({ completed, total }) => {
          setActivity(`Uploading ${completed}/${total}…`);
        });
        stored += r.stored;
      }
      if (bankFiles.length > 0) {
        const r = await uploadFilingFiles(filingPeriodId, "bank", bankFiles);
        stored += r.stored;
      }

      if (stored === 0) {
        throw new Error("No files were stored — try PDF, JPG, PNG, or bank CSV.");
      }

      if (docFiles.length > 0) {
        setActivity("Extracting invoice data…");
        await runProcess({ filingPeriodId, incremental: true });
      }
      if (bankFiles.length > 0) {
        setActivity("Importing bank CSV…");
        await runProcess({ filingPeriodId, bank: true });
      }

      return stored;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      return null;
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      setActivity(null);
    }
  }

  function revokeAttachmentPreview(attachment: PendingAttachment) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }

  function addPendingFiles(incoming: File[]) {
    const accepted = incoming.filter((f) => isSupportedChatFile(f.name));
    if (accepted.length === 0) {
      setError("No supported files selected (PDF, images, or bank CSV).");
      return;
    }
    if (accepted.length < incoming.length) {
      setError("Some files were skipped (unsupported type).");
    } else {
      setError("");
    }

    setPendingAttachments((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: isImageFile(file.name) ? URL.createObjectURL(file) : null,
      })),
    ]);
    inputRef.current?.focus();
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item) revokeAttachmentPreview(item);
      return prev.filter((a) => a.id !== id);
    });
  }

  function clearPendingAttachments() {
    setPendingAttachments((prev) => {
      for (const item of prev) revokeAttachmentPreview(item);
      return [];
    });
  }

  async function submitComposer() {
    const text = input.trim();
    const files = pendingAttachments.map((a) => a.file);
    if (!text && files.length === 0) return;
    if (loading || sending || uploading) return;

    setInput("");
    clearPendingAttachments();
    await sendMessage(text, files);
  }

  function handleChatUpload(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files;
    const files = picked ? Array.from(picked) : [];
    event.target.value = "";
    if (files.length === 0) return;
    addPendingFiles(files);
  }

  const composerBusy = loading || sending || uploading;
  const canSend = !composerBusy && (input.trim().length > 0 || pendingAttachments.length > 0);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="no-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
            {!loading
              ? displayMessages.map((msg, index) => (
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
                        <AssistantMessage
                          content={msg.content}
                          todos={todos}
                          savingKeys={savingTodoKeys}
                          onAddTodo={(line) => void addTodo(line)}
                        />
                      </div>
                    )}
                  </div>
                ))
              : null}
            {showActivity && activityLabel ? (
              <ChatActivityIndicator label={activityLabel} />
            ) : null}
          </div>
        </div>

        {error ? <p className="px-6 pb-2 text-[13px] text-red-400">{error}</p> : null}

        <div className="shrink-0 px-6 pb-6 pt-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.csv,.xlsx,.xls,.zip"
            className="hidden"
            onChange={handleChatUpload}
          />
          <form
            className="mx-auto max-w-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              void submitComposer();
            }}
          >
            <div
              className={`rounded-2xl border bg-zinc-950/80 transition ${
                composerBusy ? "border-zinc-900 opacity-60" : "border-zinc-800 focus-within:border-zinc-600"
              }`}
            >
              {pendingAttachments.length > 0 ? (
                <div className="flex flex-wrap gap-2 border-b border-zinc-900 px-3 py-2.5">
                  {pendingAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="group relative flex max-w-[160px] items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 py-1.5 pl-1.5 pr-7"
                    >
                      {attachment.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={attachment.previewUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-zinc-800 text-[10px] font-medium uppercase text-zinc-500">
                          {attachment.file.name.split(".").pop()?.slice(0, 4) ?? "file"}
                        </div>
                      )}
                      <span
                        className="min-w-0 truncate text-[11px] text-zinc-400"
                        title={attachment.file.name}
                      >
                        {shortFileName(attachment.file.name)}
                      </span>
                      <button
                        type="button"
                        disabled={composerBusy}
                        onClick={() => removePendingAttachment(attachment.id)}
                        className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[13px] text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40"
                        aria-label={`Remove ${attachment.file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end gap-1 px-2 py-2">
                <button
                  type="button"
                  disabled={composerBusy}
                  onClick={() => {
                    setError("");
                    fileInputRef.current?.click();
                  }}
                  className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-zinc-600 transition hover:text-zinc-400 disabled:opacity-40"
                  title="Add files"
                >
                  +
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submitComposer();
                    }
                  }}
                  placeholder="Message"
                  disabled={composerBusy}
                  className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-relaxed text-white outline-none placeholder:text-zinc-700 disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="mb-1 shrink-0 px-2 text-[13px] text-zinc-500 transition hover:text-white disabled:opacity-30"
                >
                  Send
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <FilingTodoPanel
        items={todos}
        deletingId={deletingTodoId}
        onDelete={(id) => void deleteTodo(id)}
      />
    </div>
  );
}
