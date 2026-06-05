import { NextRequest, NextResponse } from "next/server";
import { logChatEvent, type ChatEventType } from "@/lib/chat-logger";
import { createSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLIENT_EVENTS: ChatEventType[] = [
  "client_upload",
  "client_quick_prompt",
  "client_elster_download",
];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      filingPeriodId?: string;
      eventType?: string;
      content?: string;
      metadata?: Record<string, unknown>;
      turnId?: string;
    };

    const filingPeriodId = body.filingPeriodId?.trim();
    const eventType = body.eventType?.trim() as ChatEventType;

    if (!filingPeriodId || !eventType) {
      return NextResponse.json({ error: "Missing filingPeriodId or eventType" }, { status: 400 });
    }

    if (!CLIENT_EVENTS.includes(eventType)) {
      return NextResponse.json({ error: "Invalid client eventType" }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
    }

    await logChatEvent({
      filingPeriodId,
      turnId: body.turnId ?? null,
      eventType,
      role: "user",
      content: body.content ?? null,
      metadata: body.metadata ?? {},
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Log failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Export chat logs for Cursor analysis. Optional ?filingPeriodId=q4-2025&limit=500 */
export async function GET(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
    }

    const filingPeriodId = request.nextUrl.searchParams.get("filingPeriodId")?.trim();
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 500), 2000);

    const supabase = createSupabaseAdmin();

    let logsQuery = supabase
      .from("chat_interaction_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filingPeriodId) {
      logsQuery = logsQuery.eq("filing_period_id", filingPeriodId);
    }

    const [{ data: logs, error: logsError }, { data: turns, error: turnsError }, { data: filings }] =
      await Promise.all([
        logsQuery,
        supabase
          .from("chat_turns_summary")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(filingPeriodId ? 100 : 200),
        supabase.from("filing_periods").select("id, label").order("sort_order"),
      ]);

    if (logsError) {
      return NextResponse.json(
        {
          error: logsError.message,
          hint: "Run supabase/chat-analytics.sql in Supabase SQL Editor",
        },
        { status: 500 },
      );
    }

    if (turnsError) {
      return NextResponse.json({ error: turnsError.message }, { status: 500 });
    }

    const filteredTurns = filingPeriodId
      ? (turns ?? []).filter((t) => t.filing_period_id === filingPeriodId)
      : turns;

    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      filingPeriodId: filingPeriodId ?? null,
      filings: filings ?? [],
      turnCount: filteredTurns?.length ?? 0,
      eventCount: logs?.length ?? 0,
      turns: filteredTurns ?? [],
      events: logs ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
