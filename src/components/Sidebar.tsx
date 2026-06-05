"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  formatShortDeadline,
  getDeadlineTone,
  JAHRESABSCHLUSS,
  STEUERERKLAERUNG,
  VAT_FILINGS,
} from "@/lib/filings";

const deadlineToneClass = {
  overdue: "text-red-500",
  soon: "text-yellow-500",
  normal: "text-zinc-600",
} as const;

function NavLink({
  href,
  label,
  deadline,
  active,
}: {
  href: string;
  label: string;
  deadline: string;
  active: boolean;
}) {
  const tone = getDeadlineTone(deadline);
  const due = formatShortDeadline(deadline);

  return (
    <Link
      href={href}
      className={`flex items-baseline justify-between gap-3 py-1.5 text-[13px] transition ${
        active ? "text-white" : "text-zinc-600 hover:text-zinc-400"
      }`}
    >
      <span>{label}</span>
      <span
        className={`shrink-0 text-[10px] tabular-nums ${
          tone === "normal" && active ? "text-white/45" : deadlineToneClass[tone]
        }`}
      >
        {due}
      </span>
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
    <aside className="flex w-40 shrink-0 flex-col justify-between border-r border-zinc-900 px-5 py-8">
      <nav className="space-y-4">
        <div className="space-y-1">
          {VAT_FILINGS.map((filing) => (
            <NavLink
              key={filing.id}
              href={`/vat/${filing.id}`}
              label={filing.label}
              deadline={filing.deadline}
              active={pathname === `/vat/${filing.id}`}
            />
          ))}
        </div>

        <div className="space-y-1 border-t border-zinc-900 pt-4">
          {JAHRESABSCHLUSS.map((filing) => (
            <NavLink
              key={filing.id}
              href={`/jahresabschluss/${filing.id}`}
              label="JA 2025"
              deadline={filing.deadline}
              active={pathname === `/jahresabschluss/${filing.id}`}
            />
          ))}
          {STEUERERKLAERUNG.map((filing) => (
            <NavLink
              key={filing.id}
              href={`/steuer/${filing.id}`}
              label="Tax 2025"
              deadline={filing.deadline}
              active={pathname === `/steuer/${filing.id}`}
            />
          ))}
        </div>
      </nav>

      <button
        type="button"
        onClick={handleLogout}
        className="text-left text-[11px] text-zinc-700 hover:text-zinc-500"
      >
        out
      </button>
    </aside>
  );
}
