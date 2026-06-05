import { chatCompletionsWithRetry, getAssistantModel } from "@/lib/openai-client";
import { toolStatusLabel } from "@/lib/vat/assistant-status";
import { ASSISTANT_TOOLS } from "@/lib/vat/assistant-tools";
import { executeAssistantTool } from "@/lib/vat/apply-actions";

type ChatMessage = Record<string, unknown>;

export type ToolCallLog = {
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  ok: boolean;
};

export type AssistantRunResult = {
  reply: string;
  elsterUpdated: boolean;
  vatPayable?: number;
  toolCalls: number;
  toolDetails: ToolCallLog[];
};

function trimToolResultForModel(name: string, result: Record<string, unknown>): string {
  if (name === "refresh_elster_export") {
    return JSON.stringify({
      ok: result.ok,
      message: result.message,
      vatPayable: result.vatPayable,
      includedDocuments: result.includedDocuments,
      excludedDocuments: result.excludedDocuments,
      warnings: result.warnings,
    });
  }
  if (name === "search_filing_data") {
    return JSON.stringify(result);
  }
  if (name === "search_web") {
    return JSON.stringify({
      ok: result.ok,
      message: result.message,
      query: result.query,
      results: result.results,
    });
  }
  if (name === "get_recovery_opportunities") {
    return JSON.stringify({
      ok: result.ok,
      message: result.message,
      askUser: result.askUser,
      rcFromBank: result.rcFromBank,
      unlinkedDocuments: result.unlinkedDocuments,
    });
  }
  return JSON.stringify({
    ok: result.ok,
    message: result.message,
    affected: result.affected,
  });
}

export async function runAssistantWithTools(
  systemContent: string,
  history: Array<{ role: string; content: string }>,
  filingPeriodId: string,
  onStatus?: (message: string) => void,
): Promise<AssistantRunResult> {
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
    onStatus?.(
      round === 0 ? "Analyzing with AI…" : `Analyzing with AI (step ${round + 1})…`,
    );

    const response = await chatCompletionsWithRetry(
      {
        temperature: 0.2,
        messages,
        tools: ASSISTANT_TOOLS,
        tool_choice: "auto",
      },
      {
        onRetry: (attempt, waitMs) => {
          onStatus?.(`OpenAI rate limit — retrying in ${Math.ceil(waitMs / 1000)}s…`);
        },
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        throw new Error(
          "OpenAI rate limit — wait a few seconds and send again. (Tip: raise your org TPM tier at platform.openai.com/settings/organization/limits)",
        );
      }
      throw new Error(`OpenAI error: ${errText.slice(0, 280)}`);
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

        onStatus?.(toolStatusLabel(call.function.name, parsed));

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
          content: trimToolResultForModel(call.function.name, result as Record<string, unknown>),
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

export { getAssistantModel };
