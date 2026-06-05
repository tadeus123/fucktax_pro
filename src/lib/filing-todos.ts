export type FilingTodoItem = {
  id: string;
  text: string;
  vendor: string;
  pattern: string;
  status: "open" | "uploaded" | "not_found";
  createdAt: number;
};

export type ParsedActionLine = {
  raw: string;
  display: string;
  vendor: string;
  pattern: string;
};

const STORAGE_PREFIX = "fucktax_todos_";

export function todosStorageKey(filingPeriodId: string): string {
  return `${STORAGE_PREFIX}${filingPeriodId}`;
}

export function loadTodos(filingPeriodId: string): FilingTodoItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(todosStorageKey(filingPeriodId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FilingTodoItem[];
    return parsed.filter((t) => t.status === "open");
  } catch {
    return [];
  }
}

export function saveTodos(filingPeriodId: string, items: FilingTodoItem[]): void {
  if (typeof window === "undefined") return;
  const open = items.filter((t) => t.status === "open");
  if (open.length === 0) {
    localStorage.removeItem(todosStorageKey(filingPeriodId));
    return;
  }
  localStorage.setItem(todosStorageKey(filingPeriodId), JSON.stringify(open));
}

export function parseActionableLines(content: string): ParsedActionLine[] {
  const results: ParsedActionLine[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;

    const vendorMatch = trimmed.match(/\*\*([^*]+)\*\*/);
    if (!vendorMatch) continue;

    const body = trimmed.slice(1).trim();
    const isActionable =
      /estimated recovery|payments totaling|vorsteuer|missing invoice|upload the pdf|€/i.test(body) ||
      /:\s*\d+\s+payment/i.test(body);

    if (!isActionable) continue;

    const vendor = vendorMatch[1].trim();
    results.push({
      raw: trimmed,
      display: body,
      vendor,
      pattern: vendor.toLowerCase().split(/[:(]/)[0]?.trim() || vendor.toLowerCase(),
    });
  }

  return results;
}

export function todoItemKey(item: Pick<FilingTodoItem, "vendor" | "pattern" | "text">): string {
  return `${item.pattern}::${item.vendor}`.toLowerCase();
}

export function createTodoFromLine(line: ParsedActionLine): FilingTodoItem {
  return {
    id: crypto.randomUUID(),
    text: line.display,
    vendor: line.vendor,
    pattern: line.pattern,
    status: "open",
    createdAt: Date.now(),
  };
}
