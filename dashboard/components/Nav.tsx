"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { initials } from "@/lib/format";
import { Logo } from "./Logo";
import { PricesCard } from "./PricesCard";

const ITEMS = [
  { href: "/", label: "Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/theses", label: "Theses" },
  { href: "/journal", label: "Journal" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/assets");
  return pathname.startsWith(href);
}

export interface NavCounts {
  watchlist: number;
  theses: number;
}

function badge(href: string, counts: NavCounts) {
  if (href === "/watchlist" && counts.watchlist > 0) {
    return { n: counts.watchlist, label: "In zone: ", className: "bg-good" };
  }
  if (href === "/theses" && counts.theses > 0) {
    return { n: counts.theses, label: "Need a look: ", className: "bg-warn" };
  }
  return null;
}

export function Sidebar({
  counts,
  name,
  assistants,
  refreshed,
  fx,
}: {
  counts: NavCounts;
  name: string;
  assistants: number;
  refreshed: string;
  fx: string;
}) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col gap-5 px-3.5 py-6 lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-2 text-[18px] font-bold tracking-[-0.3px] text-ink hover:text-ink">
        <Logo />
        Ladder
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const count = badge(item.href, counts);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 items-center justify-between gap-2 rounded-xl px-3 text-sm font-semibold ${
                active ? "bg-brand-soft text-brand hover:text-brand" : "text-ink-2 hover:bg-hover hover:text-ink-2"
              }`}
            >
              {item.label}
              {count ? (
                <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-page tabular-nums ${count.className}`}>
                  <span className="sr-only">{count.label}</span>
                  {count.n}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2.5">
        <PricesCard refreshed={refreshed} fx={fx} />
        <Link href="/account#assistants" className="flex items-center gap-2.5 rounded-[14px] border border-line bg-surface px-3 py-2.5 text-ink hover:border-brand hover:text-ink">
          <span aria-hidden="true" className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-brand-soft text-brand">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0V7zM10 15v2" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-bold">AI assistants</span>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              {assistants > 0 ? <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-good" /> : null}
              {assistants > 0 ? `${assistants} connected via MCP` : "None connected yet"}
            </span>
          </span>
        </Link>
        <Link href="/account" aria-current={pathname.startsWith("/account") ? "page" : undefined} className="flex items-center gap-2.5 rounded-[14px] border border-line bg-surface p-2.5 text-ink hover:border-brand hover:text-ink">
          <span aria-hidden="true" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-brand text-[13px] font-bold text-on-brand">
            {initials(name)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-bold">{name}</span>
            <span className="text-xs text-muted">Account</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

export function BottomBar({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const count = badge(item.href, counts);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 min-w-0 items-center justify-center gap-1 text-[13px] font-semibold ${active ? "text-brand" : "text-ink-2"}`}
          >
            {item.label}
            {count ? (
              <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-page tabular-nums ${count.className}`}>
                <span className="sr-only">{count.label}</span>
                {count.n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
