import type { ReactNode } from "react";

export function renderMarkdownInline(part: string, boldClass = "font-medium text-zinc-100"): ReactNode {
  const segments = part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**")) {
      return (
        <strong key={i} className={boldClass}>
          {seg.slice(2, -2)}
        </strong>
      );
    }
    if (seg.startsWith("`") && seg.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-zinc-800 px-1 text-[12px]">
          {seg.slice(1, -1)}
        </code>
      );
    }
    return seg;
  });
}
