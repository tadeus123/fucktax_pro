import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { logAppEvent } from "@/lib/app-events";
import { expandUploadInputs, UploadIngestError } from "@/lib/upload-ingest";
import { sanitizeStorageFilename, type UploadKind } from "@/lib/upload-files";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { getOrCreateUploadSession } from "@/lib/supabase/queries";

export const maxDuration = 120;
export const runtime = "nodejs";

const BUCKETS = {
  document: "documents",
  bank: "bank-extracts",
} as const;

export async function POST(request: NextRequest) {
  let filingPeriodId = "";
  let kind: UploadKind = "document";

  try {
    const formData = await request.formData();
    filingPeriodId = String(formData.get("filingPeriodId") ?? "");
    kind = String(formData.get("kind") ?? "") as UploadKind;
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (!filingPeriodId || (kind !== "document" && kind !== "bank") || files.length === 0) {
      return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
    }

    const inputNames = files.map((file) => file.name);

    const inputs = await Promise.all(
      files.map(async (file) => ({
        relativePath: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || null,
      })),
    );

    const ingested = expandUploadInputs(inputs, { kind });

    const supabase = createSupabaseAdmin();
    const sessionId = await getOrCreateUploadSession(filingPeriodId);
    const bucket = BUCKETS[kind];
    const uploaded: Array<{ id: string; name: string }> = [];

    for (const file of ingested) {
      const safeName = sanitizeStorageFilename(file.relativePath);
      const storagePath = `${filingPeriodId}/${sessionId}/${randomUUID()}-${safeName}`;

      const { error: storageError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, file.buffer, {
          contentType: file.mimeType,
          upsert: false,
        });

      if (storageError) {
        await logAppEvent("error", "upload", "Storage upload failed", {
          filingPeriodId,
          kind,
          sessionId,
          path: file.relativePath,
          error: storageError.message,
        });
        return NextResponse.json({ error: storageError.message }, { status: 500 });
      }

      const { data: row, error: dbError } = await supabase
        .from("uploaded_files")
        .insert({
          session_id: sessionId,
          kind,
          storage_bucket: bucket,
          storage_path: storagePath,
          original_filename: file.relativePath,
          mime_type: file.mimeType,
          size_bytes: file.buffer.byteLength,
        })
        .select("id, original_filename")
        .single();

      if (dbError || !row) {
        await logAppEvent("error", "upload", "DB insert failed", {
          filingPeriodId,
          kind,
          sessionId,
          path: file.relativePath,
          error: dbError?.message ?? "unknown",
        });
        return NextResponse.json({ error: dbError?.message ?? "DB insert failed" }, { status: 500 });
      }

      uploaded.push({ id: row.id, name: row.original_filename });
    }

    await logAppEvent("info", "upload", "Upload batch stored", {
      filingPeriodId,
      kind,
      sessionId,
      received: files.length,
      stored: uploaded.length,
      inputNames,
      sampleStored: uploaded.slice(0, 5).map((f) => f.name),
    });

    return NextResponse.json({
      ok: true,
      sessionId,
      uploaded,
      received: files.length,
      stored: uploaded.length,
    });
  } catch (err) {
    if (err instanceof UploadIngestError) {
      await logAppEvent("warn", "upload", "Upload ingest rejected", {
        filingPeriodId,
        kind,
        error: err.message,
      });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    await logAppEvent("error", "upload", "Upload failed", {
      filingPeriodId,
      kind,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
