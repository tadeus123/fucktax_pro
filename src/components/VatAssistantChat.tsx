"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AssistantMessage } from "@/components/AssistantMessage";
import { ChatActivityIndicator } from "@/components/ChatActivityIndicator";
import { FilingTodoPanel } from "@/components/FilingTodoPanel";
import { logClientChatEvent } from "@/lib/chat-logger-client";
import {
  parsedLineToTodoInput,
  todoItemKey,
  type FilingTodoItem,
  type ParsedActionLine,
} from "@/lib/filing-todos";
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
  const todoFileInputRef = useRef<HTMLInputElement>(null);
  const pendingTodoIdRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [todos, setTodos] = useState<FilingTodoItem[]>([]);
  const [todoUploadingId, setTodoUploadingId] = useState<string | null>(null);

  const displayMessages = visibleMessages(messages);
  const showActivity = loading || sending || uploading || activity != null;
  const activityLabel =
    activity ??
    (loading ? "Loading chat…" : uploading ? "Uploading files…" : sending ? "Sending…" : null);

  const refreshTodos = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/filing-todos?filingPeriodId=${encodeURIComponent(filingPeriodId)}`,
      );
      const body = (await response.json()) as { todos?: FilingTodoItem[] };
      if (response.ok) setTodos(body.todos ?? []);
    } catch {
      /* table may not exist yet */
    }
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, showActivity, todos.length]);

  const addTodo = useCallback(
    async (line: ParsedActionLine) => {
      try {
        const response = await fetch("/api/filing-todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsedLineToTodoInput(line, filingPeriodId)),
        });
        const body = (await response.json()) as { todo?: FilingTodoItem };
        if (response.ok && body.todo) {
          setTodos((prev) => {
            const key = todoItemKey(body.todo!);
            if (prev.some((t) => todoItemKey(t) === key)) return prev;
            return [...prev, body.todo!];
          });
        }
      } catch {
        setError("Could not save todo — run supabase/filing-todos.sql");
      }
    },
    [filingPeriodId],
  );

  const removeTodo = useCallback(
    async (id: string, status: "uploaded" | "not_found") => {
      setTodos((prev) => prev.filter((t) => t.id !== id));
      try {
        await fetch(`/api/filing-todos/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
      } catch {
        /* ignore */
      }
      void logClientChatEvent(filingPeriodId, "client_quick_prompt", `todo_${status}`, { todoId: id });
    },
    [filingPeriodId],
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

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setActivity("Sending…");
    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

    try {
      const response = await fetch("/api/vat-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setSending(false);
      setActivity(null);
      inputRef.current?.focus();
    }
  }

  async function uploadFiles(files: File[], todo?: FilingTodoItem) {
    const bankExt = /\.(csv|xlsx|xls|ofx|qif|mt940|sta)$/i;
    const bankFiles = files.filter((f) => bankExt.test(f.name));
    const docFiles = files.filter((f) => !bankExt.test(f.name));

    if (docFiles.length === 0 && bankFiles.length === 0) return;

    setUploading(true);
    setActivity("Uploading files…");
    void logClientChatEvent(filingPeriodId, "client_upload", `${files.length} file(s)`, {
      documentCount: docFiles.length,
      bankCount: bankFiles.length,
      todoVendor: todo?.vendor,
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
        setActivity("Extracting invoice data…");
        await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filingPeriodId, incremental: true }),
        });
      }

      if (todo) {
        removeTodo(todo.id, "uploaded");
        const userMsg = `Uploaded invoice for ${todo.vendor} (${stored} file(s)). Process and update ELSTER.`;
        await sendMessage(userMsg);
      } else {
        const userMsg = `Uploaded ${stored} file(s). Process and update ELSTER.`;
        await sendMessage(userMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setTodoUploadingId(null);
      pendingTodoIdRef.current = null;
      if (!sending) setActivity(null);
    }
  }

  async function handleChatUpload(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList?.length || uploading || sending) return;
    event.target.value = "";
    await uploadFiles(Array.from(fileList));
  }

  async function handleTodoUpload(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    const todoId = pendingTodoIdRef.current;
    if (!fileList?.length || !todoId || uploading || sending) return;

    const todo = todos.find((t) => t.id === todoId);
    event.target.value = "";
    if (!todo) return;

    setTodoUploadingId(todoId);
    await uploadFiles(Array.from(fileList), todo);
  }

  function startTodoUpload(todoId: string) {
    pendingTodoIdRef.current = todoId;
    todoFileInputRef.current?.click();
  }

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
            <div ref={bottomRef} />
          </div>
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
            <input
              ref={todoFileInputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.heic,.webp"
              className="hidden"
              onChange={(e) => void handleTodoUpload(e)}
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

      <FilingTodoPanel
        items={todos}
        uploadingId={todoUploadingId}
        onUpload={startTodoUpload}
        onNotFound={(id) => void removeTodo(id, "not_found")}
      />
    </div>
  );
}
