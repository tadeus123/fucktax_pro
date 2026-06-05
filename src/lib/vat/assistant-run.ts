import { ASSISTANT_TOOLS } from "@/lib/vat/assistant-tools";
import { executeAssistantTool } from "@/lib/vat/apply-actions";

type ChatMessage = Record<string, unknown>;

export type ToolCallLog = {
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  ok: boolean;
};

function getOpenAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim();
}

export type AssistantRunResult = {
  reply: string;
  elsterUpdated: boolean;
  vatPayable?: number;
  toolCalls: number;
  toolDetails: ToolCallLog[];
};

export async function runAssistantWithTools(
  systemContent: string,
  history: Array<{ role: string; content: string }>,
  filingPeriodId: string,
): Promise<AssistantRunResult> {
  const apiKey = getOpenAiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  let toolCalls = 0;
  let elsterUpdated = false;
  let vatPayable: number | undefined;
  const toolDetails: ToolCallLog[] = [];
  const maxRounds = 8;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.2,
        messages,
        tools: ASSISTANT_TOOLS,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI error: ${errText.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    const message = payload.choices?.[0]?.message;
    if (!message) break;

    if (message.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      for (const call of message.tool_calls) {
        toolCalls += 1;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          parsed = {};
        }

        const result = await executeAssistantTool(filingPeriodId, call.function.name, parsed);
        const ok = result.ok === true;

        toolDetails.push({
          name: call.function.name,
          arguments: parsed,
          result: result as Record<string, unknown>,
          ok,
        });

        if (call.function.name === "refresh_elster_export" && ok) {
          elsterUpdated = true;
          vatPayable = result.vatPayable as number | undefined;
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    const reply =
      message.content?.trim() ??
      "Done — download the updated ELSTER XML from the button above.";

    return { reply, elsterUpdated, vatPayable, toolCalls, toolDetails };
  }

  return {
    reply: "I applied the changes. Download ELSTER XML again — numbers should be updated.",
    elsterUpdated,
    vatPayable,
    toolCalls,
    toolDetails,
  };
}
