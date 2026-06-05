"use client";

import { useCallback, useRef, useState } from "react";

type UploadZoneProps = {
  title: string;
  hint?: string;
  accept: string;
  onFilesSelected: (files: File[]) => void;
  files: File[];
  active: boolean;
  done: boolean;
};

export function UploadZone({
  title,
  hint,
  accept,
  onFilesSelected,
  files,
  active,
  done,
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

  const emphasis = active || dragOver;

  return (
    <div className="flex flex-1 flex-col">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-1 flex-col items-center justify-center rounded-2xl border px-8 py-16 text-center transition-all duration-300 ${
          emphasis
            ? "border-white bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
            : done
              ? "border-zinc-800 bg-transparent opacity-50"
              : "border-zinc-800/80 bg-transparent opacity-30"
        } ${dragOver ? "scale-[1.01]" : ""}`}
      >
        <p className={`text-xl tracking-tight ${emphasis ? "text-white" : "text-zinc-500"}`}>
          {title}
        </p>
        {done ? (
          <p className="mt-3 text-sm text-zinc-500">{files.length} files</p>
        ) : active ? (
          <>
            {hint ? (
              <p className="mt-3 max-w-[220px] text-[11px] leading-relaxed text-zinc-600">
                {hint}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-zinc-500">drop here</p>
          </>
        ) : null}
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
      </button>

      {done ? (
        <button
          type="button"
          onClick={() => onFilesSelected([])}
          className="mt-3 text-center text-[11px] text-zinc-600 hover:text-zinc-400"
        >
          clear
        </button>
      ) : (
        <div className="mt-3 h-4" />
      )}
    </div>
  );
}
