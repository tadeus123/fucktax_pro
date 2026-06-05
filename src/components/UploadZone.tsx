"use client";

import { useCallback, useRef, useState } from "react";

type UploadZoneProps = {
  title: string;
  subtitle: string;
  periodLabel: string;
  hints: string[];
  accept: string;
  onFilesSelected: (files: File[]) => void;
  files: File[];
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({
  title,
  subtitle,
  periodLabel,
  hints,
  accept,
  onFilesSelected,
  files,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      if (list.length === 0) return;
      onFilesSelected([...files, ...list]);
    },
    [files, onFilesSelected],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50">
      <div className="border-b border-zinc-800 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500">
          {periodLabel}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`mx-4 mt-4 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          dragOver
            ? "border-emerald-400 bg-emerald-500/10"
            : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/40"
        }`}
      >
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-xl">
          ↑
        </div>
        <p className="text-sm font-medium text-zinc-200">Drop files here or click to browse</p>
        <p className="mt-1 text-xs text-zinc-500">PDF, images, CSV, Excel — multiple files OK</p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="px-5 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Include
        </p>
        <ul className="space-y-1">
          {hints.map((hint) => (
            <li key={hint} className="flex gap-2 text-xs text-zinc-400">
              <span className="text-emerald-600">•</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      </div>

      {files.length > 0 ? (
        <div className="border-t border-zinc-800 px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Selected ({files.length})
            </p>
            <button
              type="button"
              onClick={() => onFilesSelected([])}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear all
            </button>
          </div>
          <ul className="max-h-36 space-y-1 overflow-y-auto">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-zinc-800/60 px-2 py-1.5 text-xs"
              >
                <span className="truncate text-zinc-300">{file.name}</span>
                <span className="shrink-0 text-zinc-500">{formatFileSize(file.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
