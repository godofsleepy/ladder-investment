import { notFound } from "next/navigation";
import Link from "next/link";
import { CopyContext } from "@/components/CopyContext";
import { LinkAsset, UnlinkAsset } from "@/components/MacroLinks";
import { Badge, eyebrow } from "@/components/ui";
import { holdingRef, macroRef } from "@/lib/context";
import { distanceText, fd, MACRO_BADGE, moneyOf, nat, pc, pct1, POSITION_BADGE, qf, WATCH_BADGE, watchKind } from "@/lib/format";
import { assets, macroView, moneySetting } from "@/lib/ladder";

const SIGNAL_DOT = { for: "bg-good", against: "bg-bad", watch: "bg-faint" } as const;
const SIGNAL_WORD = { for: "For", against: "Against", watch: "Watching" } as const;
const GRID = "grid grid-cols-[minmax(150px,1.6fr)_minmax(120px,1.2fr)_minmax(100px,1fr)_minmax(80px,.7fr)_minmax(100px,1fr)_minmax(96px,auto)_72px] gap-3";

export default async function MacroViewPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [v, options, base] = await Promise.all([macroView(id), assets(), moneySetting()]);
  const { money, signed } = moneyOf(base);
  const badge = MACRO_BADGE[v.state];
  const held = v.assets.filter((a) => a.position);
  const linked = new Set(v.assets.map((a) => a.symbol));
  const from = `view-${v.id}`;

  const stats = [
    { k: "Exposure", v: money(v.exposure_idr), sub: `${pc(v.exposure_pct)} of portfolio` },
    { k: "Stocks", v: `${held.length} held`, sub: `${v.assets.length} linked` },
    { k: "Conviction", v: v.conviction, sub: v.area },
    { k: v.overdue ? "Review was due" : "Next review", v: fd(v.next_review), sub: badge.label },
  ];

  return (
    <>
      <Link href="/theses" className="flex h-8 items-center self-start rounded-[10px] pr-2.5 pl-1.5 text-sm font-semibold hover:bg-brand-soft">‹ Theses</Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[720px] flex-col gap-1.5">
          <span className={eyebrow}>{v.area} · {v.conviction} conviction</span>
          <span className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-[32px] font-bold tracking-[-0.6px]">{v.short_name}</h1>
            <Badge className={badge.className}>{badge.label}</Badge>
          </span>
          <p className="m-0 text-[17px] leading-[1.4] font-semibold text-pretty">{v.view}</p>
        </div>
        <CopyContext wide label={`macro view #${v.id}`} text={macroRef(v.id, v.short_name)} />
      </header>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-3">
        {stats.map((s) => (
          <div key={s.k} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3.5">
            <span className="text-[13px] text-muted">{s.k}</span>
            <span className="text-[20px] font-bold tracking-[-0.3px] tabular-nums">{s.v}</span>
            <span className="text-xs text-muted">{s.sub}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="affected" className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="affected" className="m-0 text-[17px] font-bold">Stocks affected</h2>
            <span className="text-[13px] text-muted">Every stock this view moves, held or not. Held ones count towards its exposure.</span>
          </div>
          <LinkAsset viewId={v.id} options={options.filter((o) => !linked.has(o.symbol))} />
        </div>
        {v.assets.length === 0 ? (
          <p className="m-0 border-t border-line-soft px-5 py-4 text-sm text-ink-2">No stocks linked yet. Link any ticker this view would move, owned or not, or ask your agent to.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className={`${GRID} border-t border-line-soft px-5 py-2 text-right text-xs font-semibold text-muted`}>
                <span className="text-left">Asset</span>
                <span>Position</span>
                <span>Value</span>
                <span>Share</span>
                <span>P&amp;L</span>
                <span>Thesis</span>
                <span className="sr-only">Actions</span>
              </div>
              {v.assets.map((a) => {
                const p = a.position;
                const loss = p?.unrealized_idr != null && Number(p.unrealized_idr) < 0;
                const w = a.watch;
                const wk = w ? watchKind(w.distance_side, w.distance_pct) : null;
                return (
                  <div key={a.symbol} className={`relative ${GRID} items-center border-t border-line-soft px-5 py-3 text-right text-sm tabular-nums hover:bg-hover`}>
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="flex items-center gap-2">
                        <Link href={`/assets/${encodeURIComponent(a.symbol)}?from=${from}`} className="font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:text-ink">{a.symbol}</Link>
                        <CopyContext label={`${a.symbol} holding`} text={holdingRef(a.symbol)} />
                      </span>
                      {a.name !== a.symbol ? <span className="truncate text-xs text-muted">{a.name}</span> : null}
                    </span>
                    {p ? (
                      <span className="flex flex-col">
                        <span className="text-ink-2">{qf(p.qty, a.symbol, a.class)}</span>
                        <span className="text-xs text-muted">{a.price ? `at ${nat(a.currency, a.price)}` : "No price yet"}</span>
                      </span>
                    ) : (
                      <span className="flex flex-col">
                        <span className="text-ink-2">Not held</span>
                        <span className="text-xs text-muted">
                          {w && wk ? `Watchlist · ${distanceText(w.distance_side, w.distance_pct)}` : a.price ? `at ${nat(a.currency, a.price)}` : "No price yet"}
                        </span>
                      </span>
                    )}
                    <span className="font-semibold">{p ? money(p.value_idr) : ""}</span>
                    <span className="text-ink-2">{a.share_pct ? pc(a.share_pct) : ""}</span>
                    <span className={`flex flex-col ${loss ? "text-bad" : "text-good"}`}>
                      {p && p.unrealized_idr != null ? (
                        <>
                          <span className="font-semibold">{signed(p.unrealized_idr)}</span>
                          <span className="text-xs">{pct1(p.unrealized_pct)}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="flex justify-end">
                      {p ? (
                        <Badge className={POSITION_BADGE[p.state].className}>{POSITION_BADGE[p.state].label}</Badge>
                      ) : w && wk ? (
                        <Badge className={WATCH_BADGE[wk].className}>{WATCH_BADGE[wk].label}</Badge>
                      ) : null}
                    </span>
                    <span className="flex justify-end">
                      <UnlinkAsset viewId={v.id} symbol={a.symbol} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-4">
        <div className="card flex flex-col gap-3 p-5">
          <h2 className="m-0 text-[17px] font-bold">Why</h2>
          <p className="m-0 text-sm leading-normal text-pretty text-ink-2">{v.why || "Not written yet."}</p>
          <div className="border-t border-line-soft pt-3 text-sm leading-normal">
            <b className="font-semibold">Wrong if:</b> <span className="text-ink-2">{v.wrong_if}</span>
          </div>
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <h2 className="m-0 text-[17px] font-bold">Signals I watch</h2>
          {v.signals.length === 0 ? <p className="m-0 text-sm text-ink-2">None yet.</p> : null}
          {v.signals.map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm leading-[1.45]">
              <span title={SIGNAL_WORD[s.kind]} className={`mt-[6px] h-2 w-2 shrink-0 rounded-full ${SIGNAL_DOT[s.kind]}`}>
                <span className="sr-only">{SIGNAL_WORD[s.kind]}: </span>
              </span>
              <span>{s.text}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
