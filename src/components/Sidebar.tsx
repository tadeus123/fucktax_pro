"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { JAHRESABSCHLUSS, STEUERERKLAERUNG, VAT_FILINGS } from "@/lib/filings";

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`block py-1.5 text-[13px] transition ${
        active ? "text-white" : "text-zinc-600 hover:text-zinc-400"
      }`}
    >
      {label}
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
    <aside className="flex w-36 shrink-0 flex-col justify-between border-r border-zinc-900 px-5 py-8">
      <nav className="space-y-4">
        <div className="space-y-1">
          {VAT_FILINGS.map((filing) => (
            <NavLink
              key={filing.id}
              href={`/vat/${filing.id}`}
              label={filing.label}
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
              active={pathname === `/jahresabschluss/${filing.id}`}
            />
          ))}
          {STEUERERKLAERUNG.map((filing) => (
            <NavLink
              key={filing.id}
              href={`/steuer/${filing.id}`}
              label="Tax 2025"
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
