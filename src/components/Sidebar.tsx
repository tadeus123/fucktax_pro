"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  JAHRESABSCHLUSS,
  STEUERERKLAERUNG,
  VAT_FILINGS,
  type FilingStatus,
} from "@/lib/filings";

function StatusBadge({ status }: { status: FilingStatus }) {
  const styles: Record<FilingStatus, string> = {
    open: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    in_progress: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    done: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  };

  const labels: Record<FilingStatus, string> = {
    open: "Open",
    in_progress: "In progress",
    done: "Done",
  };

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function NavItem({
  href,
  label,
  deadline,
  status,
  active,
  enabled = true,
}: {
  href: string;
  label: string;
  deadline: string;
  status: FilingStatus;
  active: boolean;
  enabled?: boolean;
}) {
  const base =
    "block rounded-lg border px-3 py-2.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40";

  if (!enabled) {
    return (
      <div
        className={`${base} cursor-not-allowed border-transparent bg-zinc-900/40 opacity-60`}
        aria-disabled
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium text-zinc-400">{label}</span>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">{deadline}</p>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`${base} ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-transparent hover:border-zinc-700 hover:bg-zinc-800/80"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`text-sm font-medium ${active ? "text-white" : "text-zinc-200"}`}>
          {label}
        </span>
        <StatusBadge status={status} />
      </div>
      <p className={`mt-1 text-xs ${active ? "text-emerald-200/70" : "text-zinc-500"}`}>
        {deadline}
      </p>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500">
          fucktax
        </p>
        <h1 className="mt-1 text-lg font-semibold text-white">Pro</h1>
        <p className="mt-1 text-xs text-zinc-500">German tax filing assistant</p>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <section>
          <h2 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            VAT filings
          </h2>
          <div className="space-y-1">
            {VAT_FILINGS.map((filing) => (
              <NavItem
                key={filing.id}
                href={`/vat/${filing.id}`}
                label={filing.label}
                deadline={filing.deadlineLabel}
                status={filing.status}
                active={pathname === `/vat/${filing.id}`}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Jahresabschluss
          </h2>
          <div className="space-y-1">
            {JAHRESABSCHLUSS.map((filing) => (
              <NavItem
                key={filing.id}
                href={`/jahresabschluss/${filing.id}`}
                label={filing.label}
                deadline={filing.deadlineLabel}
                status={filing.status}
                active={pathname === `/jahresabschluss/${filing.id}`}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Tax returns
          </h2>
          <div className="space-y-1">
            {STEUERERKLAERUNG.map((filing) => (
              <NavItem
                key={filing.id}
                href={`/steuer/${filing.id}`}
                label={filing.label}
                deadline={filing.deadlineLabel}
                status={filing.status}
                active={pathname === `/steuer/${filing.id}`}
              />
            ))}
          </div>
        </section>
      </nav>

      <div className="border-t border-zinc-800 p-3">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
