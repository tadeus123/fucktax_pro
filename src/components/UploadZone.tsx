"use client";

import { useCallback, useRef, useState } from "react";
import {
  collectFilesFromDataTransfer,
  filterUploadFiles,
} from "@/lib/folder-upload";
import type { UploadKind } from "@/lib/upload-files";

type UploadZoneProps = {
  title: string;
  hint?: string;
  accept?: string;
  uploadKind: UploadKind;
  onFilesSelected: (files: File[]) => void;
  files: File[];
  storedCount?: number;
  active: boolean;
  done: boolean;
  allowFolder?: boolean;
};

export function UploadZone({
  title,
  hint,
  accept,
  uploadKind,
  onFilesSelected,
  files,
  storedCount = 0,
  active,
  done,
  allowFolder = false,
}: UploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = filterUploadFiles(Array.from(incoming), uploadKind);
      if (list.length === 0) return;
      onFilesSelected([...files, ...list]);
    },
    [files, onFilesSelected, uploadKind],
  );

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (allowFolder) {
      setScanning(true);
      try {
        const collected = await collectFilesFromDataTransfer(e.dataTransfer, uploadKind);
        if (collected.length > 0) {
          onFilesSelected([...files, ...collected]);
        }
      } finally {
        setScanning(false);
      }
      return;
    }
    addFiles(e.dataTransfer.files);
  }

  const emphasis = active || dragOver;
  const busy = scanning;
  const dropLabel = busy ? "adding files…" : "drop here";

  return (
    <div className="flex flex-1 flex-col">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!busy) fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-2xl border px-8 py-16 text-center transition-all duration-300 ${
          emphasis
            ? "border-white bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
            : done
              ? "border-zinc-800 bg-transparent opacity-50"
              : "border-zinc-800/80 bg-transparent opacity-30"
        } ${dragOver ? "scale-[1.01]" : ""} ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className={`text-xl tracking-tight ${emphasis ? "text-white" : "text-zinc-500"}`}>
          {title}
        </p>
        {done ? (
          <p className="mt-3 text-sm text-zinc-500">
            {storedCount > 0 ? `${storedCount} files stored` : `${files.length} selected`}
          </p>
        ) : active ? (
          <>
            {hint ? (
              <p className="mt-3 max-w-[240px] text-[11px] leading-relaxed text-zinc-600">
                {hint}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-zinc-500">{dropLabel}</p>
            {allowFolder && !busy ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
                className="mt-2 text-[11px] text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300"
              >
                choose folder
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {allowFolder ? (
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          multiple
          {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      ) : null}

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
