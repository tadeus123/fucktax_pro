export type ChatTurnRow = {
  turn_id: string;
  filing_period_id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  elster_updated: boolean | null;
  vat_payable: number | null;
  tool_call_count: number | null;
  all_success: boolean | null;
  last_error: string | null;
  user_message: string | null;
  assistant_reply: string | null;
};

export type ChatEventRow = {
  id: string;
  filing_period_id: string;
  turn_id: string | null;
  event_type: string;
  role: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  duration_ms: number | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
};

export type FilingLabel = { id: string; label: string };

export type ChatAnalysisReport = {
  exportedAt: string;
  filingPeriodId: string | null;
  overview: {
    totalEvents: number;
    totalTurns: number;
    errorEvents: number;
    failedTurns: number;
    toolCalls: number;
    elsterUpdates: number;
    avgResponseMs: number;
    medianResponseMs: number;
    clientDownloads: number;
    clientUploads: number;
    successRatePct: number;
  };
  byFiling: Array<{
    id: string;
    label: string;
    turns: number;
    errors: number;
    elsterUpdates: number;
    avgDurationMs: number;
  }>;
  toolUsage: Array<{ tool: string; count: number }>;
  eventTypes: Array<{ type: string; count: number }>;
  errors: Array<{ message: string; count: number; examples: string[] }>;
  intents: Array<{ intent: string; count: number; examples: string[] }>;
  recommendations: string[];
  recentTurns: Array<{
    turnId: string;
    filingLabel: string;
    startedAt: string;
    durationMs: number | null;
    userMessage: string;
    assistantPreview: string;
    toolCalls: number;
    elsterUpdated: boolean;
    success: boolean;
    error: string | null;
  }>;
  timeline: Array<{ date: string; turns: number; errors: number }>;
};

function filingLabel(filings: FilingLabel[], id: string): string {
  return filings.find((f) => f.id === id)?.label ?? id;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function normalizeError(message: string): string {
  if (message.includes("Pattern required")) return "Pattern required";
  if (message.includes("Rate limit")) return "OpenAI rate limit (TPM)";
  if (message.startsWith("OpenAI error")) return "OpenAI API error";
  return truncate(message, 80);
}

export function classifyUserIntent(message: string): string {
  const lower = message.toLowerCase();

  if (/elster|xml|upload|export|download|ready for/.test(lower)) {
    return "ELSTER / XML export";
  }
  if (/reverse charge|13b|§13b|snap|notion|cursor|steam/.test(lower)) {
    return "Reverse charge";
  }
  if (/einnahmen|ausgaben|income|expense|revenue|categor|split|how much/.test(lower)) {
    return "Income & expenses";
  }
  if (/invoice|beleg|receipt|vorsteuer|recover|optim|money back|missing/.test(lower)) {
    return "Vorsteuer / optimization";
  }
  if (/transaction|payment|who is|what is|details|company|fintech|show me/.test(lower)) {
    return "Transaction lookup";
  }
  if (/search online|google|browse|internet/.test(lower)) {
    return "Web search request";
  }
  if (/confirm|not sure|^yes$|^no$|did you/.test(lower)) {
    return "Confirmation / follow-up";
  }
  return "General Q&A";
}

function bumpIntent(
  map: Map<string, { count: number; examples: string[] }>,
  intent: string,
  example: string,
): void {
  const entry = map.get(intent) ?? { count: 0, examples: [] };
  entry.count += 1;
  if (entry.examples.length < 2) entry.examples.push(truncate(example, 100));
  map.set(intent, entry);
}

function buildRecommendations(
  turns: ChatTurnRow[],
  events: ChatEventRow[],
  errors: ChatAnalysisReport["errors"],
  intents: ChatAnalysisReport["intents"],
): string[] {
  const recs: string[] = [];

  const patternErrors = errors.find((e) => e.message === "Pattern required");
  if (patternErrors && patternErrors.count > 0) {
    recs.push(
      `Historical: ${patternErrors.count} turn(s) failed with "Pattern required" before get_quarter_cashflow / empty-pattern search_filing_data were added.`,
    );
  }

  const rateLimit = errors.find((e) => e.message.includes("rate limit"));
  if (rateLimit && rateLimit.count > 0) {
    recs.push(
      "OpenAI TPM rate limits hit during session — compact filing context further or retry backoff is working; consider a smaller model for long threads.",
    );
  }

  const webSearch = intents.find((i) => i.intent === "Web search request");
  if (webSearch && webSearch.count > 0) {
    const failedWeb = turns.some(
      (t) =>
        classifyUserIntent(t.user_message ?? "") === "Web search request" &&
        (t.assistant_reply ?? "").toLowerCase().includes("unable to browse"),
    );
    if (failedWeb) {
      recs.push(
        "User asked for web search but assistant declined — ensure search_web tool is enabled (TAVILY_API_KEY or SERPER_API_KEY) and prompt tells model to use it.",
      );
    }
  }

  const elsterTurns = turns.filter((t) => t.elster_updated).length;
  const confirmTurns = turns.filter((t) => (t.tool_call_count ?? 0) >= 3).length;
  if (confirmTurns >= 2 && elsterTurns >= 2) {
    recs.push(
      "Historical: multi-tool confirm rounds — confirm_bank_lines_batch is now available for Snap/Notion/Cursor/Steam in one call.",
    );
  }

  const incomeQuestions = intents.find((i) => i.intent === "Income & expenses");
  if (incomeQuestions && incomeQuestions.count >= 2) {
    recs.push(
      "Users repeatedly asked for quarter income/expense totals — expose deterministic bank roll-up in filing context or a dedicated get_quarter_cashflow tool.",
    );
  }

  const downloads = events.filter((e) => e.event_type === "client_elster_download").length;
  const elsterQuestions = intents.find((i) => i.intent === "ELSTER / XML export");
  if ((elsterQuestions?.count ?? 0) > downloads) {
    recs.push(
      "Users asked about XML readiness more often than they downloaded — surface export blockers inline in chat when ELSTER is mentioned.",
    );
  }

  if (recs.length === 0) {
    recs.push("No critical friction patterns detected — keep logging and re-run after more sessions.");
  }

  return recs;
}

export function analyzeChatInteractions(
  turns: ChatTurnRow[],
  events: ChatEventRow[],
  filings: FilingLabel[],
  filingPeriodId: string | null,
): ChatAnalysisReport {
  const scopedTurns = filingPeriodId
    ? turns.filter((t) => t.filing_period_id === filingPeriodId)
    : turns;
  const scopedEvents = filingPeriodId
    ? events.filter((e) => e.filing_period_id === filingPeriodId)
    : events;

  const durations = scopedTurns
    .map((t) => t.duration_ms)
    .filter((d): d is number => d != null && d > 0);

  const errorEvents = scopedEvents.filter((e) => !e.success);
  const failedTurns = scopedTurns.filter((t) => t.all_success === false || t.last_error).length;
  const toolCalls = scopedEvents.filter((e) => e.event_type === "tool_call").length;
  const elsterUpdates = scopedEvents.filter(
    (e) => e.event_type === "elster_refresh" || e.metadata?.elster_updated === true,
  ).length;

  const toolMap = new Map<string, number>();
  for (const event of scopedEvents) {
    if (event.event_type !== "tool_call" || !event.content) continue;
    toolMap.set(event.content, (toolMap.get(event.content) ?? 0) + 1);
  }

  const eventTypeMap = new Map<string, number>();
  for (const event of scopedEvents) {
    eventTypeMap.set(event.event_type, (eventTypeMap.get(event.event_type) ?? 0) + 1);
  }

  const errorMap = new Map<string, { count: number; examples: string[] }>();
  for (const event of errorEvents) {
    const msg = normalizeError(event.error_message ?? event.content ?? "Unknown error");
    const entry = errorMap.get(msg) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 2 && event.turn_id) {
      const turn = scopedTurns.find((t) => t.turn_id === event.turn_id);
      if (turn?.user_message) entry.examples.push(truncate(turn.user_message, 80));
    }
    errorMap.set(msg, entry);
  }
  for (const turn of scopedTurns) {
    if (!turn.last_error) continue;
    const msg = normalizeError(turn.last_error);
    const entry = errorMap.get(msg) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 2 && turn.user_message) {
      entry.examples.push(truncate(turn.user_message, 80));
    }
    errorMap.set(msg, entry);
  }

  const intentMap = new Map<string, { count: number; examples: string[] }>();
  for (const turn of scopedTurns) {
    if (!turn.user_message) continue;
    bumpIntent(intentMap, classifyUserIntent(turn.user_message), turn.user_message);
  }

  const filingIds = [...new Set(scopedTurns.map((t) => t.filing_period_id))];
  const byFiling = filingIds.map((id) => {
    const filingTurns = scopedTurns.filter((t) => t.filing_period_id === id);
    const filingEvents = scopedEvents.filter((e) => e.filing_period_id === id);
    const filingDurations = filingTurns
      .map((t) => t.duration_ms)
      .filter((d): d is number => d != null && d > 0);
    return {
      id,
      label: filingLabel(filings, id),
      turns: filingTurns.length,
      errors: filingTurns.filter((t) => t.last_error || t.all_success === false).length,
      elsterUpdates: filingEvents.filter(
        (e) => e.event_type === "elster_refresh" || e.metadata?.elster_updated === true,
      ).length,
      avgDurationMs:
        filingDurations.length > 0
          ? Math.round(filingDurations.reduce((s, d) => s + d, 0) / filingDurations.length)
          : 0,
    };
  });

  const dayMap = new Map<string, { turns: number; errors: number }>();
  for (const turn of scopedTurns) {
    const date = turn.started_at.slice(0, 10);
    const entry = dayMap.get(date) ?? { turns: 0, errors: 0 };
    entry.turns += 1;
    if (turn.last_error || turn.all_success === false) entry.errors += 1;
    dayMap.set(date, entry);
  }

  const errors = [...errorMap.entries()]
    .map(([message, data]) => ({ message, ...data }))
    .sort((a, b) => b.count - a.count);

  const intents = [...intentMap.entries()]
    .map(([intent, data]) => ({ intent, ...data }))
    .sort((a, b) => b.count - a.count);

  const successRatePct =
    scopedTurns.length > 0
      ? Math.round(((scopedTurns.length - failedTurns) / scopedTurns.length) * 100)
      : 100;

  return {
    exportedAt: new Date().toISOString(),
    filingPeriodId,
    overview: {
      totalEvents: scopedEvents.length,
      totalTurns: scopedTurns.length,
      errorEvents: errorEvents.length,
      failedTurns,
      toolCalls,
      elsterUpdates,
      avgResponseMs:
        durations.length > 0
          ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
          : 0,
      medianResponseMs: Math.round(median(durations)),
      clientDownloads: scopedEvents.filter((e) => e.event_type === "client_elster_download").length,
      clientUploads: scopedEvents.filter((e) => e.event_type === "client_upload").length,
      successRatePct,
    },
    byFiling: byFiling.sort((a, b) => b.turns - a.turns),
    toolUsage: [...toolMap.entries()]
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count),
    eventTypes: [...eventTypeMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    errors,
    intents,
    recommendations: buildRecommendations(scopedTurns, scopedEvents, errors, intents),
    recentTurns: scopedTurns.slice(0, 20).map((turn) => ({
      turnId: turn.turn_id,
      filingLabel: filingLabel(filings, turn.filing_period_id),
      startedAt: turn.started_at,
      durationMs: turn.duration_ms,
      userMessage: turn.user_message ?? "",
      assistantPreview: truncate(turn.assistant_reply ?? "", 160),
      toolCalls: turn.tool_call_count ?? 0,
      elsterUpdated: turn.elster_updated === true,
      success: turn.all_success !== false && !turn.last_error,
      error: turn.last_error,
    })),
    timeline: [...dayMap.entries()]
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
