import { NextRequest, NextResponse } from "next/server";
import type { FilingTodoKind } from "@/lib/filing-todos";
import {
  createFilingTodo,
  listFilingTodos,
} from "@/lib/supabase/filing-todos-queries";

export async function GET(request: NextRequest) {
  const filingPeriodId = request.nextUrl.searchParams.get("filingPeriodId")?.trim();
  if (!filingPeriodId) {
    return NextResponse.json({ error: "Missing filingPeriodId" }, { status: 400 });
  }

  try {
    const todos = await listFilingTodos(filingPeriodId);
    return NextResponse.json({ todos });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load todos" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      filingPeriodId?: string;
      text?: string;
      vendor?: string;
      pattern?: string;
      kind?: FilingTodoKind;
      metadata?: Record<string, unknown>;
      sourceMessageId?: string;
    };

    const filingPeriodId = body.filingPeriodId?.trim();
    const text = body.text?.trim();
    if (!filingPeriodId || !text) {
      return NextResponse.json({ error: "Missing filingPeriodId or text" }, { status: 400 });
    }

    const result = await createFilingTodo({
      filingPeriodId,
      text,
      vendor: body.vendor?.trim() ?? text.slice(0, 40),
      pattern: body.pattern?.trim() ?? text.slice(0, 24).toLowerCase(),
      kind: body.kind ?? "action",
      metadata: body.metadata,
      sourceMessageId: body.sourceMessageId,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Run supabase/filing-todos.sql to enable todos." },
        { status: 503 },
      );
    }

    return NextResponse.json({ todo: result.todo });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create todo" },
      { status: 500 },
    );
  }
}
