export const SKIP_PATH_PARTS = ["__macosx", ".git", "node_modules"] as const;

export const SKIP_BASENAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".gitignore",
]);

export const ZIP_EXTENSIONS = new Set([".zip", ".zipx"]);

export const BANK_EXTENSIONS = new Set([
  ".csv",
  ".pdf",
  ".xlsx",
  ".xls",
  ".txt",
  ".ofx",
  ".qif",
  ".xml",
  ".sta",
  ".mt940",
  ...ZIP_EXTENSIONS,
]);

export type UploadKind = "document" | "bank";

export function normalizeUploadPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isSkippedUploadPath(relativePath: string): boolean {
  const normalized = normalizeUploadPath(relativePath).toLowerCase();
  if (!normalized) return true;

  const parts = normalized.split("/");
  const basename = parts[parts.length - 1] ?? normalized;

  if (!basename || basename.startsWith(".")) return true;
  if (SKIP_BASENAMES.has(basename)) return true;
  return parts.some((part) => SKIP_PATH_PARTS.includes(part as (typeof SKIP_PATH_PARTS)[number]));
}

export function getFileExtension(relativePath: string): string {
  const basename = normalizeUploadPath(relativePath).split("/").pop() ?? relativePath;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 ? basename.slice(dot).toLowerCase() : "";
}

export function isZipPath(relativePath: string): boolean {
  return ZIP_EXTENSIONS.has(getFileExtension(relativePath));
}

export function mimeFromPath(relativePath: string): string {
  const ext = getFileExtension(relativePath);
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".bmp": "image/bmp",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".json": "application/json",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".zip": "application/zip",
    ".zipx": "application/zip",
    ".ofx": "application/x-ofx",
    ".qif": "application/qif",
  };
  return map[ext] ?? "application/octet-stream";
}

export function sanitizeStorageFilename(relativePath: string): string {
  const normalized = normalizeUploadPath(relativePath);
  return normalized.replace(/[^\w.\-()/ ]+/g, "_");
}

export function isAllowedUploadPath(relativePath: string, kind: UploadKind): boolean {
  if (isSkippedUploadPath(relativePath)) return false;

  const ext = getFileExtension(relativePath);
  if (ZIP_EXTENSIONS.has(ext)) return true;

  if (kind === "document") {
    return true;
  }

  return BANK_EXTENSIONS.has(ext);
}

export function filterUploadPaths(paths: string[], kind: UploadKind): string[] {
  return paths.filter((path) => isAllowedUploadPath(path, kind));
}

export function filterUploadFiles(files: File[], kind: UploadKind): File[] {
  return files.filter((file) => {
    const path = getUploadRelativePath(file);
    return isAllowedUploadPath(path, kind);
  });
}

export function getUploadRelativePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  return normalizeUploadPath(relative || file.name);
}

export function zipRootPrefix(zipPath: string): string {
  const basename = normalizeUploadPath(zipPath).split("/").pop() ?? zipPath;
  return basename.replace(/\.(zip|zipx)$/i, "") || "archive";
}

export function joinUploadPath(prefix: string, innerPath: string): string {
  const left = normalizeUploadPath(prefix);
  const right = normalizeUploadPath(innerPath);
  return left ? `${left}/${right}` : right;
}
