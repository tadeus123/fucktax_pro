import { getUploadRelativePath } from "@/lib/upload-files";

export type UploadProgress = {
  completed: number;
  total: number;
};

export type UploadedFileRef = {
  id: string;
  name: string;
};

export type UploadResult = {
  stored: number;
  received: number;
  uploaded: UploadedFileRef[];
};

const MAX_BYTES_PER_REQUEST = 4 * 1024 * 1024;

async function parseUploadError(response: Response): Promise<string> {
  if (response.status === 413) {
    return "File too large for server (max ~4 MB per upload). Try one PDF at a time.";
  }
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Upload failed (HTTP ${response.status})`;
}

export async function uploadFilingFiles(
  filingPeriodId: string,
  kind: "document" | "bank",
  files: File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  let stored = 0;
  let received = 0;
  const uploaded: UploadedFileRef[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (file.size > MAX_BYTES_PER_REQUEST) {
      throw new Error(
        `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB — max ~4 MB per file. Split or compress.`,
      );
    }

    const formData = new FormData();
    formData.append("filingPeriodId", filingPeriodId);
    formData.append("kind", kind);
    formData.append("files", file, getUploadRelativePath(file));

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error(await parseUploadError(response));
    }

    const body = (await response.json()) as {
      stored?: number;
      received?: number;
      uploaded?: UploadedFileRef[];
    };
    stored += body.stored ?? 1;
    received += body.received ?? 1;
    if (body.uploaded?.length) {
      uploaded.push(...body.uploaded);
    }
    onProgress?.({ completed: index + 1, total: files.length });
  }

  return { stored, received, uploaded };
}
