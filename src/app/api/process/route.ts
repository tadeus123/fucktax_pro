import { NextRequest, NextResponse } from "next/server";
import { logAppEvent } from "@/lib/app-events";
import { runFilingProcess } from "@/lib/process/run";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { filingPeriodId?: string };
    const filingPeriodId = body.filingPeriodId?.trim();

    if (!filingPeriodId) {
      return NextResponse.json({ error: "Missing filingPeriodId" }, { status: 400 });
    }

    const result = await runFilingProcess(filingPeriodId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    await logAppEvent("error", "process", message, {});
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
