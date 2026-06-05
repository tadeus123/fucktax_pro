import type { FilingTodoItem, FilingTodoKind, FilingTodoStatus } from "@/lib/filing-todos";
import { todoItemKey } from "@/lib/filing-todos";
import { createSupabaseAdmin } from "@/lib/supabase/server";

type TodoRow = {
  id: string;
  filing_period_id: string;
  text: string;
  vendor: string;
  pattern: string;
  item_key?: string | null;
  kind: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const TODO_SELECT =
  "id, filing_period_id, text, vendor, pattern, kind, status, metadata, created_at";

function rowToTodo(row: TodoRow): FilingTodoItem {
  const meta = row.metadata ?? {};
  const itemKey =
    row.item_key ||
    (typeof meta.itemKey === "string" ? meta.itemKey : undefined) ||
    todoItemKey({ vendor: row.vendor, pattern: row.pattern, text: row.text });

  return {
    id: row.id,
    text: row.text,
    vendor: row.vendor,
    pattern: row.pattern,
    kind: row.kind as FilingTodoItem["kind"],
    status: row.status as FilingTodoStatus,
    createdAt: row.created_at,
    metadata: meta,
    itemKey,
  };
}

function resolveItemKey(input: {
  text: string;
  vendor: string;
  pattern: string;
  metadata?: Record<string, unknown>;
}): string {
  const fromMeta = input.metadata?.itemKey;
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  return todoItemKey({ vendor: input.vendor, pattern: input.pattern, text: input.text });
}

async function findOpenTodo(
  filingPeriodId: string,
  itemKey: string,
  pattern: string,
  text: string,
): Promise<TodoRow | null> {
  const supabase = createSupabaseAdmin();

  const { data: openTodos, error } = await supabase
    .from("filing_todos")
    .select(TODO_SELECT)
    .eq("filing_period_id", filingPeriodId)
    .eq("status", "open");

  if (error) {
    if (error.message.includes("filing_todos")) return null;
    throw new Error(error.message);
  }

  for (const row of openTodos ?? []) {
    const todo = rowToTodo(row as TodoRow);
    if (todo.itemKey === itemKey) return row as TodoRow;
    if (row.pattern === pattern && row.text === text) return row as TodoRow;
  }

  return null;
}

export async function listFilingTodos(filingPeriodId: string): Promise<FilingTodoItem[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("filing_todos")
    .select(TODO_SELECT)
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
  const itemKey = resolveItemKey(input);
  const metadata = { ...(input.metadata ?? {}), itemKey };

  const existing = await findOpenTodo(
    input.filingPeriodId,
    itemKey,
    input.pattern,
    input.text,
  );
  if (existing) {
    return { todo: rowToTodo(existing), created: false };
  }

  const insertPayload: Record<string, unknown> = {
    filing_period_id: input.filingPeriodId,
    text: input.text,
    vendor: input.vendor,
    pattern: input.pattern,
    kind: input.kind,
    metadata,
    source_message_id: input.sourceMessageId ?? null,
  };

  const { data, error } = await supabase
    .from("filing_todos")
    .insert(insertPayload)
    .select(TODO_SELECT)
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

/** Only auto-add invoice recovery lines — manual + todo for everything else. */
export async function syncAutoTodosFromMessage(
  filingPeriodId: string,
  content: string,
  sourceMessageId?: string,
): Promise<number> {
  const { parseActionableLines, parsedLineToTodoInput } = await import("@/lib/filing-todos");
  const lines = parseActionableLines(content).filter((line) => line.autoAdd);
  let created = 0;

  for (const line of lines) {
    const result = await createFilingTodo({
      ...parsedLineToTodoInput(line, filingPeriodId, sourceMessageId),
    });
    if (result?.created) created += 1;
  }

  return created;
}
