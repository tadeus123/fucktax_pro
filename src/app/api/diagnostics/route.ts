import { NextResponse } from "next/server";
import { getUploadDiagnostics } from "@/lib/upload-diagnostics";
import { createSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
    }

    const supabase = createSupabaseAdmin();
    const { error: pingError } = await supabase.from("filing_periods").select("id").limit(1);
    if (pingError) {
      return NextResponse.json({ error: pingError.message }, { status: 500 });
    }

    const report = await getUploadDiagnostics();
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Diagnostics failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
