type ChatCompletionBody = Record<string, unknown>;

function getAssistantModel(): string {
  return process.env.OPENAI_ASSISTANT_MODEL?.trim() || "gpt-4o";
}

function parseRetrySeconds(errorText: string): number {
  const match = errorText.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000);
  return 3000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function chatCompletionsWithRetry(
  body: Omit<ChatCompletionBody, "model"> & { model?: string },
  options?: { maxRetries?: number },
): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const maxRetries = options?.maxRetries ?? 6;
  const payload = { ...body, model: body.model ?? getAssistantModel() };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok || response.status !== 429 || attempt === maxRetries) {
      return response;
    }

    const errText = await response.text();
    const waitMs = parseRetrySeconds(errText) + attempt * 500;
    await sleep(Math.min(waitMs, 60000));
  }

  throw new Error("OpenAI rate limit — retries exhausted");
}

export { getAssistantModel };
