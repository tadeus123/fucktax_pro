/** Fire-and-forget client-side chat analytics (uploads, quick prompts, downloads). */
export async function logClientChatEvent(
  filingPeriodId: string,
  eventType: "client_upload" | "client_quick_prompt" | "client_elster_download",
  content?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch("/api/chat-analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filingPeriodId, eventType, content, metadata }),
    });
  } catch {
    // analytics must not block UX
  }
}
