import { getUploadRelativePath } from "@/lib/upload-files";

const BATCH_SIZE = 20;

export type UploadResult = {
  stored: number;
  received: number;
};

export async function uploadFilingFiles(
  filingPeriodId: string,
  kind: "document" | "bank",
  files: File[],
): Promise<UploadResult> {
  let stored = 0;
  let received = 0;

  for (let offset = 0; offset < files.length; offset += BATCH_SIZE) {
    const batch = files.slice(offset, offset + BATCH_SIZE);
    const formData = new FormData();
    formData.append("filingPeriodId", filingPeriodId);
    formData.append("kind", kind);
    for (const file of batch) {
      formData.append("files", file, getUploadRelativePath(file));
    }

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Upload failed");
    }

    const body = (await response.json()) as { stored?: number; received?: number };
    stored += body.stored ?? batch.length;
    received += body.received ?? batch.length;
  }

  return { stored, received };
}
