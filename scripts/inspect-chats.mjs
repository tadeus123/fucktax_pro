/**
 * Export all fucktax AI chat interactions for Cursor analysis.
 *
 * Setup:
 *   1. Run supabase/chat-analytics.sql in Supabase SQL Editor (once)
 *   2. npm run inspect:chats
 *
 * In Cursor, say: "analyze the fucktax chat interactions"
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(filename) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const filingFilter = process.argv.find((a) => a.startsWith("--filing="))?.slice(9);

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  let logsQuery = supabase
    .from("chat_interaction_logs")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(2000);

  let turnsQuery = supabase
    .from("chat_turns_summary")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(200);

  if (filingFilter) {
    logsQuery = logsQuery.eq("filing_period_id", filingFilter);
    turnsQuery = turnsQuery.eq("filing_period_id", filingFilter);
  }

  const [{ data: logs, error: logsError }, { data: turns, error: turnsError }, { data: filings }] =
    await Promise.all([
      logsQuery,
      turnsQuery,
      supabase.from("filing_periods").select("id, label").order("sort_order"),
    ]);

  if (logsError) {
    console.error("\n❌ chat_interaction_logs:", logsError.message);
    console.error("\n→ Run supabase/chat-analytics.sql in Supabase SQL Editor first.\n");
    process.exit(1);
  }

  if (turnsError) {
    console.warn("⚠ chat_turns_summary view missing — run chat-analytics.sql");
  }

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    filingFilter: filingFilter ?? "all",
    filings: filings ?? [],
    summary: {
      totalEvents: logs?.length ?? 0,
      totalTurns: turns?.length ?? 0,
      errors: (logs ?? []).filter((e) => !e.success).length,
      toolCalls: (logs ?? []).filter((e) => e.event_type === "tool_call").length,
      elsterUpdates: (logs ?? []).filter(
        (e) => e.metadata?.elster_updated === true || e.event_type === "elster_refresh",
      ).length,
    },
    turns: turns ?? [],
    events: logs ?? [],
  };

  const outDir = resolve(process.cwd(), "diagnostics");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "chat-logs-latest.json");
  writeFileSync(outPath, JSON.stringify(exportPayload, null, 2), "utf8");

  console.log("\n=== fucktax chat interaction log ===\n");
  console.log(`Events: ${exportPayload.summary.totalEvents}`);
  console.log(`Turns:  ${exportPayload.summary.totalTurns}`);
  console.log(`Errors: ${exportPayload.summary.errors}`);
  console.log(`Tool calls: ${exportPayload.summary.toolCalls}`);
  console.log(`ELSTER updates: ${exportPayload.summary.elsterUpdates}`);
  console.log(`\nFull export: ${outPath}\n`);

  if (turns?.length) {
    console.log("--- Recent turns ---\n");
    for (const turn of turns.slice(0, 15)) {
      const label = filings?.find((f) => f.id === turn.filing_period_id)?.label ?? turn.filing_period_id;
      console.log(`[${label}] ${turn.started_at?.slice(0, 16)}`);
      console.log(`  User: ${String(turn.user_message ?? "").slice(0, 120)}`);
      console.log(`  AI:   ${String(turn.assistant_reply ?? "").slice(0, 120)}`);
      console.log(`  Tools: ${turn.tool_call_count ?? 0} | ELSTER: ${turn.elster_updated ? "yes" : "no"}`);
      if (turn.last_error) console.log(`  Error: ${turn.last_error}`);
      console.log("");
    }
  } else if (!logs?.length) {
    console.log("No chat events logged yet. Use the VAT assistant online, then re-run.\n");
  }

  console.log('In Cursor: say "analyze the fucktax chat interactions"\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
