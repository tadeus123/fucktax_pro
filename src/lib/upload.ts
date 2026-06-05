import { getUploadRelativePath } from "@/lib/upload-files";

export type UploadProgress = {
  completed: number;
  total: number;
};

export type UploadResult = {
  stored: number;
  received: number;
};

export async function uploadFilingFiles(
  filingPeriodId: string,
  kind: "document" | "bank",
  files: File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  let stored = 0;
  let received = 0;
  const batchSize = kind === "bank" ? 1 : 8;

  for (let offset = 0; offset < files.length; offset += batchSize) {
    const batch = files.slice(offset, offset + batchSize);
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
    onProgress?.({ completed: Math.min(offset + batch.length, files.length), total: files.length });
  }

  return { stored, received };
}
