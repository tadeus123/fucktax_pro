import { unzipSync } from "fflate";
import {
  isAllowedUploadPath,
  isSkippedUploadPath,
  isZipPath,
  joinUploadPath,
  mimeFromPath,
  normalizeUploadPath,
  type UploadKind,
  zipRootPrefix,
} from "@/lib/upload-files";

export type IngestedUploadFile = {
  relativePath: string;
  buffer: Buffer;
  mimeType: string;
};

export type IngestOptions = {
  kind: UploadKind;
  maxDepth?: number;
  maxFiles?: number;
  maxTotalBytes?: number;
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILES = 1000;
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export class UploadIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadIngestError";
  }
}

export function expandUploadBuffer(
  relativePath: string,
  buffer: Buffer,
  mimeType: string | null,
  options: IngestOptions,
  depth = 0,
  state: { count: number; bytes: number } = { count: 0, bytes: 0 },
): IngestedUploadFile[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const path = normalizeUploadPath(relativePath);

  if (isSkippedUploadPath(path)) {
    return [];
  }

  if (isZipPath(path)) {
    if (depth >= maxDepth) {
      throw new UploadIngestError(`Archive nested too deeply: ${path}`);
    }

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(buffer), { filter: () => true });
    } catch {
      throw new UploadIngestError(
        `Could not unzip ${path}. If it is password-protected, unzip locally and upload the folder instead.`,
      );
    }

    const prefix = zipRootPrefix(path);
    const expanded: IngestedUploadFile[] = [];

    for (const [entryPath, data] of Object.entries(entries)) {
      if (entryPath.endsWith("/")) continue;
      const nestedPath = joinUploadPath(prefix, entryPath);
      expanded.push(
        ...expandUploadBuffer(
          nestedPath,
          Buffer.from(data),
          mimeFromPath(nestedPath),
          options,
          depth + 1,
          state,
        ),
      );
    }

    return expanded;
  }

  if (!isAllowedUploadPath(path, options.kind)) {
    return [];
  }

  state.count += 1;
  state.bytes += buffer.byteLength;

  if (state.count > maxFiles) {
    throw new UploadIngestError(`Too many files (limit ${maxFiles}). Split into smaller folders.`);
  }

  if (state.bytes > maxTotalBytes) {
    throw new UploadIngestError(
      `Total upload size too large (limit ${Math.round(maxTotalBytes / (1024 * 1024))} MB).`,
    );
  }

  return [
    {
      relativePath: path,
      buffer,
      mimeType: mimeType || mimeFromPath(path),
    },
  ];
}

export function expandUploadInputs(
  inputs: Array<{ relativePath: string; buffer: Buffer; mimeType: string | null }>,
  options: IngestOptions,
): IngestedUploadFile[] {
  const state = { count: 0, bytes: 0 };
  const expanded = inputs.flatMap((input) =>
    expandUploadBuffer(input.relativePath, input.buffer, input.mimeType, options, 0, state),
  );

  if (expanded.length === 0) {
    throw new UploadIngestError(
      options.kind === "document"
        ? "No supported files found. Upload a folder, zip, or individual documents."
        : "No supported bank files found. Upload a CSV/PDF export or a zip containing one.",
    );
  }

  const seen = new Set<string>();
  return expanded.filter((file) => {
    const key = file.relativePath.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
