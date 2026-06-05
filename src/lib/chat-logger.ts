import { logAppEvent } from "@/lib/app-events";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export type ChatEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "system_opening"
  | "smart_defaults"
  | "elster_refresh"
  | "process_incremental"
  | "client_upload"
  | "client_quick_prompt"
  | "client_elster_download"
  | "api_error";

export type LogChatEventInput = {
  filingPeriodId: string;
  turnId?: string | null;
  eventType: ChatEventType;
  role?: "user" | "assistant" | "system" | "tool";
  content?: string | null;
  metadata?: Record<string, unknown>;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string | null;
  uploadSessionId?: string | null;
};

async function resolveUploadSessionId(filingPeriodId: string): Promise<string | null> {
  try {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
      .from("upload_sessions")
      .select("id")
      .eq("filing_period_id", filingPeriodId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function logChatEvent(input: LogChatEventInput): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    const uploadSessionId =
      input.uploadSessionId ?? (await resolveUploadSessionId(input.filingPeriodId));

    const { error } = await supabase.from("chat_interaction_logs").insert({
      filing_period_id: input.filingPeriodId,
      upload_session_id: uploadSessionId,
      turn_id: input.turnId ?? null,
      event_type: input.eventType,
      role: input.role ?? null,
      content: input.content ?? null,
      metadata: input.metadata ?? {},
      duration_ms: input.durationMs ?? null,
      success: input.success ?? true,
      error_message: input.errorMessage ?? null,
    });

    if (error) {
      await logAppEvent("warn", "chat_logger", "chat_interaction_logs insert failed", {
        message: error.message,
        eventType: input.eventType,
        filingPeriodId: input.filingPeriodId,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "log failed";
    await logAppEvent("warn", "chat_logger", message, {
      eventType: input.eventType,
      filingPeriodId: input.filingPeriodId,
    });
  }
}

export function newChatTurnId(): string {
  return crypto.randomUUID();
}
