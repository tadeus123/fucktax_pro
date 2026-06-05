"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatShortDeadline, getDeadlineTone } from "@/lib/filings";
import type { SidebarFiling } from "@/lib/supabase/queries";

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

export function Sidebar({ filings }: { filings: SidebarFiling[] }) {
  const pathname = usePathname();
  const router = useRouter();

  const vat = filings.filter((f) => f.filingType === "vat");
  const other = filings.filter((f) => f.filingType !== "vat");

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-40 shrink-0 flex-col justify-between border-r border-zinc-900 px-5 py-8">
      <nav className="space-y-4">
        <div className="space-y-1">
          {vat.map((filing) => (
            <NavLink
              key={filing.href}
              href={filing.href}
              label={filing.label}
              deadline={filing.deadline}
              active={pathname === filing.href}
            />
          ))}
        </div>

        {other.length > 0 ? (
          <div className="space-y-1 border-t border-zinc-900 pt-4">
            {other.map((filing) => (
              <NavLink
                key={filing.href}
                href={filing.href}
                label={filing.label}
                deadline={filing.deadline}
                active={pathname === filing.href}
              />
            ))}
          </div>
        ) : null}
      </nav>

      <div className="space-y-1">
        <Link
          href="/company"
          className={`block py-1.5 text-[11px] transition ${
            pathname === "/company" ? "text-zinc-400" : "text-zinc-700 hover:text-zinc-500"
          }`}
        >
          company
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="block py-1.5 text-left text-[11px] text-zinc-700 hover:text-zinc-500"
        >
          out
        </button>
      </div>
    </aside>
  );
}
