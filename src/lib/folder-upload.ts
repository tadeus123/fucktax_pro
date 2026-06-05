const SKIP_PATH_PARTS = ["__macosx", ".git", "node_modules"] as const;
const SKIP_BASENAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".gitignore",
]);

export function parseAcceptExtensions(accept: string): Set<string> {
  const extensions = new Set<string>();
  for (const part of accept.split(",")) {
    const trimmed = part.trim().toLowerCase();
    if (trimmed.startsWith(".")) {
      extensions.add(trimmed);
    }
  }
  return extensions;
}

export function getUploadRelativePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  return relative || file.name;
}

export function isSkippedUploadPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/");
  const basename = parts[parts.length - 1] ?? normalized;

  if (!basename || basename.startsWith(".")) return true;
  if (SKIP_BASENAMES.has(basename)) return true;
  return parts.some((part) => SKIP_PATH_PARTS.includes(part as (typeof SKIP_PATH_PARTS)[number]));
}

export function fileMatchesAccept(file: File, extensions: Set<string>): boolean {
  if (extensions.size === 0) return true;

  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if (extensions.has(ext)) return true;

  if (file.type) {
    for (const accepted of extensions) {
      if (accepted === ".jpg" && file.type === "image/jpeg") return true;
      if (accepted === ".jpeg" && file.type === "image/jpeg") return true;
    }
  }

  return false;
}

export function filterUploadFiles(files: File[], accept: string): File[] {
  const extensions = parseAcceptExtensions(accept);
  return files.filter((file) => {
    const path = getUploadRelativePath(file);
    if (isSkippedUploadPath(path)) return false;
    return fileMatchesAccept(file, extensions);
  });
}

function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = [];

    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };

    readBatch();
  });
}

async function entryToFiles(entry: FileSystemEntry | null, pathPrefix = ""): Promise<File[]> {
  if (!entry) return [];

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    const relativePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    });
    return [file];
  }

  if (entry.isDirectory) {
    const dirPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
    if (isSkippedUploadPath(`${dirPath}/`)) return [];

    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllDirectoryEntries(reader);
    const nested = await Promise.all(children.map((child) => entryToFiles(child, dirPath)));
    return nested.flat();
  }

  return [];
}

export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer,
  accept: string,
): Promise<File[]> {
  const items = Array.from(dataTransfer.items);
  const hasEntries = items.some((item) => typeof item.webkitGetAsEntry === "function");

  let files: File[] = [];

  if (hasEntries) {
    const fromEntries = await Promise.all(
      items.map((item) => entryToFiles(item.webkitGetAsEntry?.() ?? null)),
    );
    files = fromEntries.flat();
  } else {
    files = Array.from(dataTransfer.files);
  }

  return filterUploadFiles(files, accept);
}
