import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { getOrCreateUploadSession } from "@/lib/supabase/queries";

const BUCKETS = {
  document: "documents",
  bank: "bank-extracts",
} as const;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const filingPeriodId = String(formData.get("filingPeriodId") ?? "");
    const kind = String(formData.get("kind") ?? "") as "document" | "bank";
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (!filingPeriodId || (kind !== "document" && kind !== "bank") || files.length === 0) {
      return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    const sessionId = await getOrCreateUploadSession(filingPeriodId);
    const bucket = BUCKETS[kind];
    const uploaded: Array<{ id: string; name: string }> = [];

    for (const file of files) {
      const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
      const storagePath = `${filingPeriodId}/${sessionId}/${randomUUID()}-${safeName}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const { error: storageError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (storageError) {
        return NextResponse.json({ error: storageError.message }, { status: 500 });
      }

      const { data: row, error: dbError } = await supabase
        .from("uploaded_files")
        .insert({
          session_id: sessionId,
          kind,
          storage_bucket: bucket,
          storage_path: storagePath,
          original_filename: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
        })
        .select("id, original_filename")
        .single();

      if (dbError || !row) {
        return NextResponse.json({ error: dbError?.message ?? "DB insert failed" }, { status: 500 });
      }

      uploaded.push({ id: row.id, name: row.original_filename });
    }

    return NextResponse.json({ ok: true, sessionId, uploaded });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
