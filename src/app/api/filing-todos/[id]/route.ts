import { NextRequest, NextResponse } from "next/server";
import type { FilingTodoStatus } from "@/lib/filing-todos";
import {
  deleteFilingTodo,
  updateFilingTodoStatus,
} from "@/lib/supabase/filing-todos-queries";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { status?: FilingTodoStatus };
    const status = body.status;

    if (!status || !["open", "uploaded", "not_found", "done"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await updateFilingTodoStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update todo" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await deleteFilingTodo(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete todo" },
      { status: 500 },
    );
  }
}
