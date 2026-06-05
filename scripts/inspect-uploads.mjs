/**
 * Inspect Supabase uploads from the terminal.
 *
 * Setup:
 *   1. Copy .env.example → .env.local and fill in Supabase keys
 *   2. Run supabase/diagnostics.sql in Supabase SQL Editor (once)
 *   3. npm run inspect:uploads
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
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

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const [{ data: filings }, { data: sessions }, { data: files }, { data: events, error: eventsError }] =
    await Promise.all([
      supabase.from("filing_periods").select("id, label").order("sort_order"),
      supabase
        .from("upload_sessions")
        .select("id, filing_period_id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("uploaded_files")
        .select("session_id, kind, original_filename, size_bytes, processing_status, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("app_events")
        .select("level, source, message, context, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  console.log("\n=== fucktax upload diagnostics ===\n");

  for (const filing of filings ?? []) {
    const filingSessionIds = new Set(
      (sessions ?? []).filter((s) => s.filing_period_id === filing.id).map((s) => s.id),
    );
    const filingFiles = (files ?? []).filter((f) => filingSessionIds.has(f.session_id));
    const docs = filingFiles.filter((f) => f.kind === "document");
    const bank = filingFiles.filter((f) => f.kind === "bank");
    const bytes = filingFiles.reduce((sum, f) => sum + Number(f.size_bytes ?? 0), 0);

    console.log(`${filing.label} (${filing.id})`);
    console.log(`  documents: ${docs.length}  bank: ${bank.length}  total size: ${formatBytes(bytes)}`);
    if (docs.length > 0) {
      console.log(`  sample docs: ${docs.slice(0, 3).map((f) => f.original_filename).join(" | ")}`);
    }
    if (bank.length > 0) {
      console.log(`  sample bank: ${bank.slice(0, 3).map((f) => f.original_filename).join(" | ")}`);
    }
    const failed = filingFiles.filter((f) => f.processing_status === "failed");
    if (failed.length > 0) {
      console.log(`  FAILED: ${failed.length}`);
    }
    console.log("");
  }

  console.log("--- recent server events ---");
  if (eventsError) {
    console.log("  (app_events table missing — run supabase/diagnostics.sql)");
  } else if (!events?.length) {
    console.log("  (no events yet — logging starts after next deploy + upload)");
  } else {
    for (const event of events) {
      console.log(`  [${event.level}] ${event.created_at} ${event.message}`);
    }
  }

  console.log("\n=== end ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
