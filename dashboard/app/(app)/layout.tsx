import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Logo } from "@/components/Logo";
import { BottomBar, Sidebar } from "@/components/Nav";
import { initials, refreshedLabel, watchKind } from "@/lib/format";
import { connections, macroViews, priceStatus, watchlist } from "@/lib/ladder";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [assistants, watch, views, prices] = await Promise.all([connections(), watchlist(), macroViews(), priceStatus()]);
  const counts = {
    watchlist: watch.items.filter((i) => watchKind(i.distance_side, i.distance_pct) === "zone").length,
    theses: views.filter((v) => v.state !== "holding").length,
  };
  const fx = prices.usd_idr ? `Rp${Math.round(Number(prices.usd_idr)).toLocaleString("id-ID")}` : "Not fetched yet";

  return (
    <>
      <AutoRefresh />
      <div className="flex min-h-screen">
        <Sidebar counts={counts} name={user.name} assistants={assistants.length} refreshed={refreshedLabel(prices.refreshed_at)} fx={fx} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between px-4 pt-3 lg:hidden">
            <span className="flex items-center gap-2">
              <Logo size={28} />
              <span className="text-[18px] font-bold tracking-[-0.3px]">Ladder</span>
            </span>
            <Link href="/account" aria-label="Account" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-[13px] font-bold text-on-brand hover:text-on-brand">
              {initials(user.name)}
            </Link>
          </div>
          <main className="mx-auto flex max-w-[1080px] flex-col gap-5 px-4 pt-5 pb-24 sm:px-7 lg:pt-8 lg:pb-16">{children}</main>
        </div>
      </div>
      <BottomBar counts={counts} />
    </>
  );
}
