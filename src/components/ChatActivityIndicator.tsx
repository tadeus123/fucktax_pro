export function ChatActivityIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex shrink-0 items-center gap-1.5 pt-1.5" aria-hidden>
        <span className="chat-dot h-2.5 w-2.5 rounded-sm bg-zinc-500" />
        <span className="chat-dot chat-dot-delay-1 h-2.5 w-2.5 rounded-sm bg-zinc-500" />
        <span className="chat-dot chat-dot-delay-2 h-2.5 w-2.5 rounded-sm bg-zinc-500" />
      </div>
      <p className="text-[13px] leading-relaxed text-zinc-500">{label}</p>
    </div>
  );
}
