export type FilingTodoKind = "invoice_recovery" | "action" | "upload" | "review";

export type FilingTodoStatus = "open" | "uploaded" | "not_found" | "done";

export type FilingTodoItem = {
  id: string;
  text: string;
  vendor: string;
  pattern: string;
  kind: FilingTodoKind;
  status: FilingTodoStatus;
  createdAt: string;
  itemKey?: string;
  metadata?: Record<string, unknown>;
};

export type ParsedActionLine = {
  raw: string;
  display: string;
  vendor: string;
  pattern: string;
  kind: FilingTodoKind;
  metadata: Record<string, unknown>;
};

const ACTION_VERBS =
  /upload|confirm|review|exclude|check|invoice|receipt|beleg|provide|obtain|gather|download|sum up|calculate|verify|match|identify/i;

const RECOVERY_SIGNAL =
  /estimated recovery|payments totaling|vorsteuer|missing invoice|upload the pdf|€|payment/i;

function parseBulletBody(trimmed: string): { body: string; isBullet: boolean } {
  const bullet = trimmed.match(/^(-|\d+\.)\s+([\s\S]+)$/);
  if (!bullet) return { body: trimmed, isBullet: false };
  return { body: bullet[2].trim(), isBullet: true };
}

function extractVendorAndDisplay(body: string): { vendor: string; display: string } {
  const bold = body.match(/^\*\*([^*]+)\*\*:?\s*(.*)$/);
  if (bold) {
    const vendor = bold[1].trim();
    const rest = bold[2]?.trim() ?? "";
    const display = rest ? `**${vendor}:** ${rest}` : `**${vendor}:**`;
    return { vendor, display };
  }
  const colon = body.match(/^([^:]{3,60}):\s*(.+)$/);
  if (colon) {
    return { vendor: colon[1].trim(), display: body };
  }
  return { vendor: body.slice(0, 48).trim(), display: body };
}

function extractRecoveryMetadata(display: string): Record<string, unknown> {
  const recovery = display.match(/estimated recovery:\s*€?([\d.,]+)/i);
  const total = display.match(/totaling\s*€?([\d.,]+)/i);
  const count = display.match(/(\d+)\s+payment/i);
  return {
    estimatedRecoveryEur: recovery?.[1] ?? null,
    totalEur: total?.[1] ?? null,
    paymentCount: count?.[1] ?? null,
  };
}

export function parseActionableLines(content: string): ParsedActionLine[] {
  const results: ParsedActionLine[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const { body, isBullet } = parseBulletBody(trimmed);
    if (!isBullet) continue;

    const { vendor, display } = extractVendorAndDisplay(body);
    const isRecovery = RECOVERY_SIGNAL.test(display);
    const hasBoldLabel = /^\*\*[^*]+\*\*/.test(body);
    const isAction = ACTION_VERBS.test(display);

    const isActionable =
      isRecovery || (hasBoldLabel && (isAction || display.includes(":"))) || isAction;

    if (!isActionable) continue;

    const kind: FilingTodoKind = isRecovery
      ? "invoice_recovery"
      : /upload|invoice|receipt|beleg/i.test(display)
        ? "upload"
        : /review|check|verify|confirm/i.test(display)
          ? "review"
          : "action";

    const key = `${kind}::${vendor.toLowerCase()}::${display.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      raw: trimmed,
      display,
      vendor,
      pattern: vendor.toLowerCase().split(/[:(]/)[0]?.trim() || vendor.toLowerCase(),
      kind,
      metadata: extractRecoveryMetadata(display),
    });
  }

  return results;
}

export function todoItemKey(item: Pick<FilingTodoItem, "vendor" | "pattern" | "text">): string {
  const pattern = (item.pattern || item.vendor).toLowerCase().trim();
  const text = item.text.toLowerCase().replace(/\s+/g, " ").trim();
  return `${pattern}::${text}`;
}

export function todoKeyForItem(item: FilingTodoItem): string {
  if (item.itemKey) return item.itemKey;
  return todoItemKey(item);
}

export function todoKeyFromLine(line: Pick<ParsedActionLine, "vendor" | "pattern" | "display">): string {
  return todoItemKey({ vendor: line.vendor, pattern: line.pattern, text: line.display });
}

export function parsedLineToTodoInput(
  line: ParsedActionLine,
  filingPeriodId: string,
  sourceMessageId?: string,
): {
  filingPeriodId: string;
  text: string;
  vendor: string;
  pattern: string;
  kind: FilingTodoKind;
  metadata: Record<string, unknown>;
  sourceMessageId?: string;
} {
  return {
    filingPeriodId,
    text: line.display,
    vendor: line.vendor,
    pattern: line.pattern,
    kind: line.kind,
    metadata: { ...line.metadata, itemKey: todoKeyFromLine(line) },
    sourceMessageId,
  };
}
