import {
  filterUploadFiles as filterByKind,
  getUploadRelativePath,
  type UploadKind,
} from "@/lib/upload-files";

export { getUploadRelativePath } from "@/lib/upload-files";

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
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllDirectoryEntries(reader);
    const nested = await Promise.all(children.map((child) => entryToFiles(child, dirPath)));
    return nested.flat();
  }

  return [];
}

export function filterUploadFiles(files: File[], kind: UploadKind): File[] {
  return filterByKind(files, kind);
}

export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer,
  kind: UploadKind,
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

  return filterByKind(files, kind);
}
