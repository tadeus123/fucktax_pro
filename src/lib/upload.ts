export async function uploadFilingFiles(
  filingPeriodId: string,
  kind: "document" | "bank",
  files: File[],
): Promise<void> {
  const formData = new FormData();
  formData.append("filingPeriodId", filingPeriodId);
  formData.append("kind", kind);
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Upload failed");
  }
}
