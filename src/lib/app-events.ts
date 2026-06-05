import { createSupabaseAdmin } from "@/lib/supabase/server";

export type AppEventLevel = "info" | "warn" | "error";

export async function logAppEvent(
  level: AppEventLevel,
  source: string,
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    await supabase.from("app_events").insert({
      level,
      source,
      message,
      context,
    });
  } catch {
    console.error(`[${level}] ${source}: ${message}`, context);
  }
}
