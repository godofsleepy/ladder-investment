import Link from "next/link";
import { CopyContext } from "@/components/CopyContext";
import { Badge, Empty, PageTitle, Tally } from "@/components/ui";
import { watchContext } from "@/lib/context";
import { distanceText, fd, nat, WATCH_BADGE, watchKind, type WatchKind } from "@/lib/format";
import { watchlist } from "@/lib/ladder";

const GRID = "grid grid-cols-[minmax(200px,2.4fr)_minmax(90px,1fr)_minmax(150px,1.3fr)_minmax(110px,1fr)_104px] gap-3";

export default async function WatchlistPage() {
  const { items } = await watchlist();
  const rows = items
    .map((item) => ({ item, kind: watchKind(item.distance_side, item.distance_pct) }))
    .sort((a, b) => Number(b.kind === "zone") - Number(a.kind === "zone"));
  const order: WatchKind[] = ["zone", "near", "wait"];

  return (
    <>
      <PageTitle title="Watchlist" sub="Before the buy: ideas with a buy zone. Ladder flags them when the price enters the zone." />
      {rows.length === 0 ? (
        <Empty title="No ideas yet">Tell your agent an asset you would buy at the right price, for example: "Watch ANTM, buy zone 1,400 to 1,550, reason: nickel recovery".</Empty>
      ) : (
        <>
          <Tally items={order.map((k) => ({ label: WATCH_BADGE[k].label, dot: WATCH_BADGE[k].dot, n: rows.filter((r) => r.kind === k).length }))} />
          <section aria-label="Ideas" className="card overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[660px]">
                <div className={`${GRID} px-5 py-3 text-right text-xs font-semibold text-muted`}>
                  <span className="text-left">Idea</span>
                  <span>Price</span>
                  <span>Buy zone</span>
                  <span>Distance</span>
                  <span>Status</span>
                </div>
                {rows.map(({ item: w, kind }) => {
                  const badge = WATCH_BADGE[kind];
                  const distance = distanceText(w.distance_side, w.distance_pct);
                  return (
                    <div key={w.id} className={`relative ${GRID} items-center border-t border-line-soft px-5 py-3.5 text-right text-sm text-ink tabular-nums hover:bg-hover hover:text-ink`}>
                      <span className="flex min-w-0 flex-col gap-[3px] text-left">
                        <span className="flex items-baseline gap-2">
                          <Link href={`/assets/${w.symbol}?from=watchlist`} className="font-bold text-ink after:absolute after:inset-0 after:content-[''] hover:text-ink">{w.symbol}</Link>
                          <CopyContext id={w.id} label={`watchlist item #${w.id}`} text={watchContext(w, kind, distance)} />
                          {w.name !== w.symbol ? <span className="truncate text-xs text-muted">{w.name}</span> : null}
                        </span>
                        <span className="text-[13px] leading-[1.4] text-pretty text-ink-2">{w.reason}</span>
                        <span className="text-xs text-muted">Added {fd(w.added_at)} · {w.thesis_id ? "Draft thesis written" : "No draft thesis yet"}</span>
                      </span>
                      <span className="font-semibold">{nat(w.currency, w.price)}</span>
                      <span className="text-ink-2">{nat(w.currency, w.zone_low)} – {nat(w.currency, w.zone_high)}</span>
                      <span className={`font-semibold ${badge.text}`}>{distance}</span>
                      <span className="flex justify-end"><Badge className={badge.className}>{badge.label}</Badge></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
          <p className="m-0 text-[13px] text-muted">When you buy an idea, it leaves the watchlist and its draft becomes an active thesis.</p>
        </>
      )}
    </>
  );
}
