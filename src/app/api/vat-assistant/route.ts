import { NextRequest, NextResponse } from "next/server";
import { logChatEvent, newChatTurnId } from "@/lib/chat-logger";
import { VAT_ASSISTANT_SYSTEM_PROMPT } from "@/lib/vat/assistant-prompt";
import { runAssistantWithTools } from "@/lib/vat/assistant-run";
import { applySmartDefaults, refreshElsterExport } from "@/lib/vat/apply-actions";
import { buildFilingContext, buildOpeningMessage } from "@/lib/vat/build-filing-context";
import {
  getReviewData,
  getReviewMessages,
  saveReviewMessage,
} from "@/lib/supabase/queries";

export const maxDuration = 120;
export const runtime = "nodejs";

function getOpenAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim();
}

export async function GET(request: NextRequest) {
  const filingPeriodId = request.nextUrl.searchParams.get("filingPeriodId")?.trim();
  if (!filingPeriodId) {
    return NextResponse.json({ error: "Missing filingPeriodId" }, { status: 400 });
  }

  const review = await getReviewData(filingPeriodId);
  if (!review) {
    return NextResponse.json({ error: "Filing not found" }, { status: 404 });
  }

  let messages = await getReviewMessages(filingPeriodId);

  if (messages.length === 0) {
    const opening = buildOpeningMessage(review);
    const saved = await saveReviewMessage(filingPeriodId, "assistant", opening);
    await logChatEvent({
      filingPeriodId,
      eventType: "system_opening",
      role: "assistant",
      content: opening,
      metadata: { source: "first_load" },
    });
    messages = saved
      ? [{ role: "assistant" as const, content: opening, id: saved }]
      : [{ role: "assistant" as const, content: opening }];
  }

  return NextResponse.json({ messages, stats: review.stats });
}

export async function POST(request: NextRequest) {
  const turnId = newChatTurnId();
  const startedAt = Date.now();
  let filingPeriodIdForError = "";

  try {
    const body = (await request.json()) as {
      filingPeriodId?: string;
      message?: string;
      action?: "smart_defaults";
    };
    const filingPeriodId = body.filingPeriodId?.trim();
    const message = body.message?.trim();
    filingPeriodIdForError = filingPeriodId ?? "";

    if (!filingPeriodId) {
      return NextResponse.json({ error: "Missing filingPeriodId" }, { status: 400 });
    }

    const apiKey = getOpenAiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured — add it to enable the assistant." },
        { status: 503 },
      );
    }

    if (body.action === "smart_defaults") {
      await logChatEvent({
        filingPeriodId,
        turnId,
        eventType: "user_message",
        role: "user",
        content: "Just make it work — clean up and build ELSTER",
        metadata: { action: "smart_defaults" },
      });

      await applySmartDefaults(filingPeriodId);
      await logChatEvent({
        filingPeriodId,
        turnId,
        eventType: "smart_defaults",
        metadata: { trigger: "api_action" },
      });

      const refreshed = await refreshElsterExport(filingPeriodId);
      await logChatEvent({
        filingPeriodId,
        turnId,
        eventType: "elster_refresh",
        metadata: { vat_payable: refreshed.vatPayable, source: "smart_defaults" },
      });

      const reply = `Applied smart defaults. ELSTER updated — VAT payable **${refreshed.vatPayable?.toFixed(2) ?? "?"} EUR**. Download ELSTER XML now.`;
      await saveReviewMessage(filingPeriodId, "assistant", reply);
      await logChatEvent({
        filingPeriodId,
        turnId,
        eventType: "assistant_message",
        role: "assistant",
        content: reply,
        durationMs: Date.now() - startedAt,
        metadata: { elster_updated: true, vat_payable: refreshed.vatPayable },
      });

      return NextResponse.json({
        reply,
        elsterUpdated: true,
        vatPayable: refreshed.vatPayable,
      });
    }

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    await saveReviewMessage(filingPeriodId, "user", message);
    await logChatEvent({
      filingPeriodId,
      turnId,
      eventType: "user_message",
      role: "user",
      content: message,
    });

    const [context, history] = await Promise.all([
      buildFilingContext(filingPeriodId),
      getReviewMessages(filingPeriodId),
    ]);

    if (!context) {
      return NextResponse.json({ error: "Could not build filing context" }, { status: 404 });
    }

    const result = await runAssistantWithTools(
      `${VAT_ASSISTANT_SYSTEM_PROMPT}\n\n--- CURRENT FILING DATA ---\n${context}`,
      history.filter((m) => m.role !== "system").slice(-20),
      filingPeriodId,
    );

    for (const tool of result.toolDetails) {
      await logChatEvent({
        filingPeriodId,
        turnId,
        eventType: "tool_call",
        role: "tool",
        content: tool.name,
        metadata: { arguments: tool.arguments },
      });
      await logChatEvent({
        filingPeriodId,
        turnId,
        eventType: "tool_result",
        role: "tool",
        content: tool.name,
        success: tool.ok,
        metadata: { result: tool.result },
        errorMessage: tool.ok ? null : String(tool.result.message ?? "tool failed"),
      });
    }

    if (!result.elsterUpdated && result.toolCalls > 0) {
      const refreshed = await refreshElsterExport(filingPeriodId);
      result.elsterUpdated = true;
      result.vatPayable = refreshed.vatPayable;
      await logChatEvent({
        filingPeriodId,
        turnId,
        eventType: "elster_refresh",
        metadata: { vat_payable: refreshed.vatPayable, source: "post_tools" },
      });
    }

    await saveReviewMessage(filingPeriodId, "assistant", result.reply);
    await logChatEvent({
      filingPeriodId,
      turnId,
      eventType: "assistant_message",
      role: "assistant",
      content: result.reply,
      durationMs: Date.now() - startedAt,
      metadata: {
        elster_updated: result.elsterUpdated,
        vat_payable: result.vatPayable,
        tool_calls: result.toolCalls,
        model: "gpt-4o",
      },
    });

    return NextResponse.json({
      reply: result.reply,
      elsterUpdated: result.elsterUpdated,
      vatPayable: result.vatPayable,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Assistant failed";

    if (filingPeriodIdForError) {
      await logChatEvent({
        filingPeriodId: filingPeriodIdForError,
        turnId,
        eventType: "api_error",
        success: false,
        errorMessage: msg,
        durationMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
