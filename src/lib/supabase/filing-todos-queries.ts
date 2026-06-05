import type { FilingTodoItem, FilingTodoKind, FilingTodoStatus } from "@/lib/filing-todos";
import { createSupabaseAdmin } from "@/lib/supabase/server";

type TodoRow = {
  id: string;
  filing_period_id: string;
  text: string;
  vendor: string;
  pattern: string;
  kind: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function rowToTodo(row: TodoRow): FilingTodoItem {
  return {
    id: row.id,
    text: row.text,
    vendor: row.vendor,
    pattern: row.pattern,
    kind: row.kind as FilingTodoItem["kind"],
    status: row.status as FilingTodoStatus,
    createdAt: row.created_at,
    metadata: row.metadata ?? undefined,
  };
}

export async function listFilingTodos(filingPeriodId: string): Promise<FilingTodoItem[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("filing_todos")
    .select("id, filing_period_id, text, vendor, pattern, kind, status, metadata, created_at")
    .eq("filing_period_id", filingPeriodId)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (error) {
    if (error.message.includes("filing_todos")) return [];
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => rowToTodo(row as TodoRow));
}

export async function createFilingTodo(input: {
  filingPeriodId: string;
  text: string;
  vendor: string;
  pattern: string;
  kind: FilingTodoKind;
  metadata?: Record<string, unknown>;
  sourceMessageId?: string;
}): Promise<{ todo: FilingTodoItem; created: boolean } | null> {
  const supabase = createSupabaseAdmin();

  const { data: existing } = await supabase
    .from("filing_todos")
    .select("id, filing_period_id, text, vendor, pattern, kind, status, metadata, created_at")
    .eq("filing_period_id", input.filingPeriodId)
    .eq("pattern", input.pattern)
    .eq("status", "open")
    .eq("text", input.text)
    .maybeSingle();

  if (existing) {
    return { todo: rowToTodo(existing as TodoRow), created: false };
  }

  const { data, error } = await supabase
    .from("filing_todos")
    .insert({
      filing_period_id: input.filingPeriodId,
      text: input.text,
      vendor: input.vendor,
      pattern: input.pattern,
      kind: input.kind,
      metadata: input.metadata ?? {},
      source_message_id: input.sourceMessageId ?? null,
    })
    .select("id, filing_period_id, text, vendor, pattern, kind, status, metadata, created_at")
    .single();

  if (error) {
    if (error.message.includes("filing_todos")) return null;
    throw new Error(error.message);
  }

  return { todo: rowToTodo(data as TodoRow), created: true };
}

export async function updateFilingTodoStatus(
  id: string,
  status: FilingTodoStatus,
): Promise<boolean> {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("filing_todos")
    .update({
      status,
      updated_at: new Date().toISOString(),
      resolved_at: status === "open" ? null : new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return true;
}

export async function syncAutoTodosFromMessage(
  filingPeriodId: string,
  content: string,
  sourceMessageId?: string,
): Promise<number> {
  const { parseActionableLines, parsedLineToTodoInput } = await import("@/lib/filing-todos");
  const lines = parseActionableLines(content);
  let created = 0;

  for (const line of lines) {
    const result = await createFilingTodo({
      ...parsedLineToTodoInput(line, filingPeriodId, sourceMessageId),
    });
    if (result?.created) created += 1;
  }

  return created;
}
