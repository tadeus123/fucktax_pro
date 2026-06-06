type ChatCompletionBody = Record<string, unknown>;

/** Mini = ~10× higher TPM on free/low tiers; good enough for VAT assistant + extraction. */
const DEFAULT_ASSISTANT_MODEL = "gpt-4o-mini";
const DEFAULT_EXTRACTION_MODEL = "gpt-4o-mini";

function getAssistantModel(): string {
  return process.env.OPENAI_ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
}

function getExtractionModel(): string {
  return process.env.OPENAI_EXTRACTION_MODEL?.trim() || DEFAULT_EXTRACTION_MODEL;
}

function parseRetryMs(response: Response, errorText: string): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  }
  const match = errorText.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000);
  return 3000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gap between back-to-back OpenAI calls (upload batch / Continue). Reduces TPM bursts. */
export function openAiThrottleDelayMs(): number {
  const raw = process.env.OPENAI_THROTTLE_MS?.trim();
  const n = raw ? Number(raw) : 1500;
  return Number.isFinite(n) && n >= 0 ? n : 1500;
}

export async function waitForOpenAiThrottle(): Promise<void> {
  const ms = openAiThrottleDelayMs();
  if (ms > 0) await sleep(ms);
}

export async function chatCompletionsWithRetry(
  body: Omit<ChatCompletionBody, "model"> & { model?: string },
  options?: { maxRetries?: number; onRetry?: (attempt: number, waitMs: number) => void },
): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const maxRetries = options?.maxRetries ?? 8;
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
    const waitMs = Math.min(parseRetryMs(response, errText) + attempt * 1000, 90000);
    options?.onRetry?.(attempt + 1, waitMs);
    await sleep(waitMs);
  }

  throw new Error("OpenAI rate limit — retries exhausted");
}

export { getAssistantModel, getExtractionModel, sleep };
