import { today } from "@ladder/dates";
import Link from "next/link";
import { PageActions } from "@/components/PageActions";
import { PriceChart } from "@/components/PriceChart";
import { ThesisActions } from "@/components/ThesisActions";
import { CopyContext } from "@/components/CopyContext";
import { Badge, eyebrow } from "@/components/ui";
import { assetRef, noteRef, thesisRef, tradeRef, watchRef } from "@/lib/context";
import { capitalize, classLabel, convictionWord, fd, moneyOf, nat, pc, pct1, POSITION_BADGE, positionWhy, qf, refreshedLabel } from "@/lib/format";
import { assetDetail, assets, moneySetting, positions, priceChart, priceStatus, type Review, type Trade } from "@/lib/ladder";

const FEEDS: Record<string, string> = { coingecko: "CoinGecko", yahoo: "Yahoo Finance", xau: "XAU spot", manual: "Manual" };
const BACK: Record<string, { href: string; label: string }> = {
  watchlist: { href: "/watchlist", label: "Watchlist" },
  theses: { href: "/theses", label: "Theses" },
  trades: { href: "/trades", label: "Trade log" },
  journal: { href: "/journal", label: "Journal" },
};

function verdict(r: Review): { label: string; tone: string } {
  if (r.action === "close") return { label: "Closed", tone: "text-bad" };
  if (!r.still_valid) return { label: "Weaker", tone: "text-warn" };
  return r.action === "update" ? { label: "Edited", tone: "text-ink-2" } : { label: "Holds", tone: "text-good" };
}

export default async function AssetPage({ params, searchParams }: { params: Promise<{ symbol: string }>; searchParams: Promise<{ from?: string }> }) {
  const { symbol } = await params;
  const { from } = await searchParams;
  const d = await assetDetail(decodeURIComponent(symbol));
  const [{ positions: open }, options, base, status, chart] = await Promise.all([positions(), assets(), moneySetting(), priceStatus(), priceChart(d.asset.symbol)]);
  const { money, signed } = moneyOf(base);
  const viewId = /^view-(\d+)$/.exec(from ?? "")?.[1];
  const back = viewId ? { href: `/theses/${viewId}`, label: "Macro view" } : (BACK[from ?? ""] ?? { href: "/", label: "Portfolio" });

  const a = d.asset;
  const position = open.find((p) => p.symbol === a.symbol) ?? null;
  const t = d.thesis;
  const w = d.watchlist_item;
  const price = position?.price ?? options.find((o) => o.symbol === a.symbol)?.price ?? null;
  const trades = d.trades as unknown as Trade[];
  const notes = d.recent_notes as Array<{ id: number; body: string; author: string; created_at: Date }>;
  const reviews = (d.thesis_reviews as unknown as Review[]).filter((r) => r.note);
  const badge = position ? POSITION_BADGE[position.state] : null;
  const flagged = position?.state === "alert" || position?.state === "review";
  const loss = position?.unrealized_idr != null && Number(position.unrealized_idr) < 0;
  const over = position?.reason === "cap";
  const every = t ? capitalize(t.review_every) : "";


  const stats = position
    ? [
        { k: "Value", v: money(position.value_idr), sub: qf(position.qty, a.symbol, a.class), tone: "" },
        { k: "Unrealised P&L", v: signed(position.unrealized_idr), sub: pct1(position.unrealized_pct), tone: loss ? "text-bad" : "text-good" },
        { k: "Avg cost", v: position.avg_cost ? nat(a.currency, position.avg_cost) : nat("IDR", position.avg_cost_idr), sub: `Cost ${money(position.cost_idr)}`, tone: "" },
        { k: "Weight", v: position.weight_pct ? pc(position.weight_pct) : "No price", sub: position.cap_pct ? `Cap ${pc(position.cap_pct)}` : "No cap", tone: over ? "text-bad" : "" },
      ]
    : [];

  const rules = t
    ? [
        { k: "Conviction", v: convictionWord(t.conviction) },
        { k: "Add", v: t.add_rule ?? "Not set" },
        { k: "Trim", v: t.trim_rule ?? "Not set" },
        { k: "Invalidate if", v: t.kill_criteria },
        { k: "Review", v: `${every} · last ${t.last_reviewed ? fd(t.last_reviewed) : "not yet"} · next ${fd(t.next_review)}` },
      ]
    : [];

  return (
    <>
      <Link href={back.href} className="flex h-8 items-center self-start rounded-[10px] pr-2.5 pl-1.5 text-sm font-semibold hover:bg-brand-soft">‹ {back.label}</Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className={eyebrow}>{classLabel(a.class)}{a.name !== a.symbol ? ` · ${a.name}` : ""}</span>
          <span className="flex flex-wrap items-baseline gap-3">
            <h1 className="m-0 text-[36px] font-bold tracking-[-0.8px]">{a.symbol}</h1>
            <span className="text-[20px] font-semibold tabular-nums">{nat(a.currency, price)}</span>
          </span>
          <span className="text-[13px] text-muted">{FEEDS[a.price_source] ?? a.price_source} · {refreshedLabel(status.refreshed_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyContext wide label={a.symbol} text={assetRef(a.symbol)} />
          <PageActions assets={options} today={today()} defaultSymbol={a.symbol} />
        </div>
      </header>

      {stats.length > 0 ? (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-3">
          {stats.map((s) => (
            <div key={s.k} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3.5">
              <span className="text-[13px] text-muted">{s.k}</span>
              <span className={`text-[20px] font-bold tracking-[-0.3px] tabular-nums ${s.tone}`}>{s.v}</span>
              <span className="text-xs text-muted tabular-nums">{s.sub}</span>
            </div>
          ))}
        </section>
      ) : null}

      <PriceChart symbol={a.symbol} currency={a.currency} points={chart.points} needsHistory={chart.needs_history} />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-4">
        <div className="card flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <h2 className="m-0 text-[17px] font-bold">Thesis</h2>
              {t ? <CopyContext id={t.id} label={`thesis #${t.id}`} text={thesisRef(t.id, a.symbol)} /> : null}
            </span>
            {t?.status === "draft" ? <Badge className="bg-fill text-ink-2">Draft</Badge> : badge ? <Badge className={badge.className}>{badge.label}</Badge> : null}
          </div>

          {t ? (
            <>
              <div className="flex flex-col gap-2">
                <p className="m-0 text-[17px] leading-[1.4] font-semibold text-pretty">{t.title}</p>
                {t.why ? <p className="m-0 text-sm leading-normal text-pretty text-ink-2">{t.why}</p> : null}
              </div>
              {flagged && position && badge ? (
                <div className={`rounded-xl px-3 py-2.5 text-[13px] font-semibold ${badge.className}`}>{positionWhy(position)}</div>
              ) : null}
              <div className="flex flex-col">
                {rules.map((rule) => (
                  <div key={rule.k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-t border-line-soft py-[9px] text-sm leading-[1.4]">
                    <span className="text-muted">{rule.k}</span>
                    <span className="text-pretty">{rule.v}</span>
                  </div>
                ))}
              </div>
              <ThesisActions
                symbol={a.symbol}
                currency={a.currency}
                canReview={t.status === "active"}
                values={{ id: t.id, statement: t.title, invalidate: t.kill_criteria, alertBelow: t.kill_price ?? "", every: t.review_every }}
              />
              {reviews.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className={eyebrow}>Reviews</span>
                  {reviews.map((r, i) => {
                    const v = verdict(r);
                    return (
                      <div key={i} className="grid grid-cols-[56px_60px_minmax(0,1fr)] gap-2 text-[13px] leading-[1.4]">
                        <span className="text-muted">{fd(r.reviewed_at)}</span>
                        <span className={`font-semibold ${v.tone}`}>{v.label}</span>
                        <span className="text-ink-2">{r.note}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="m-0 text-sm leading-normal text-ink-2">No thesis yet. Every open position needs one: why you own it, and what would make you sell.</p>
              <ThesisActions symbol={a.symbol} currency={a.currency} canReview={false} values={{ id: null, statement: "", invalidate: "", alertBelow: "", every: "quarterly" }} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {w ? (
            <div className="card flex flex-col gap-1 p-5">
              <span className="flex items-center gap-2">
                <h2 className="m-0 text-[17px] font-bold">Buy zone</h2>
                <CopyContext id={w.id} label={`watchlist item #${w.id}`} text={watchRef(w.id, a.symbol)} />
              </span>
              <p className="m-0 text-sm text-ink-2 tabular-nums">{nat(a.currency, w.zone_low)} – {nat(a.currency, w.zone_high)}</p>
              <p className="m-0 text-[13px] text-pretty text-muted">{w.reason}</p>
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
              <h2 className="m-0 text-[17px] font-bold">Trades</h2>
              <span className="text-[13px] text-muted">{trades.length} {trades.length === 1 ? "trade" : "trades"}</span>
            </div>
            {trades.length === 0 ? <div className="border-t border-line-soft px-5 py-4 text-sm text-muted">No trades yet.</div> : null}
            {trades.map((tr) => (
              <div key={tr.id} className="grid grid-cols-[76px_40px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line-soft px-5 py-2.5 text-sm tabular-nums">
                <span className="flex flex-col items-start gap-1 text-[13px] text-muted">
                  {fd(tr.date)}
                  <CopyContext id={tr.id} label={`trade #${tr.id}`} text={tradeRef(tr.id, tr.type, a.symbol, tr.date)} />
                </span>
                <span className="font-semibold">{capitalize(tr.type)}</span>
                <span className="text-ink-2">{qf(tr.qty, a.symbol, a.class)} @ {nat(tr.currency, tr.price)}</span>
                <span className="font-semibold">{nat(tr.currency, Number(tr.qty) * Number(tr.price))}</span>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
              <h2 className="m-0 text-[17px] font-bold">Notes</h2>
              {notes.length > 0 ? <span className="text-[13px] text-muted">{notes.length}</span> : null}
            </div>
            {notes.length === 0 ? <div className="border-t border-line-soft px-5 py-4 text-sm text-muted">No notes yet.</div> : null}
            {notes.map((note) => (
              <div key={note.id} className="flex flex-col gap-1 border-t border-line-soft px-5 py-3">
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">{fd(note.created_at)} · {note.author} <CopyContext id={note.id} label={`note #${note.id}`} text={noteRef(note.id, a.symbol)} /></span>
                <span className="text-sm leading-normal text-pretty">{note.body}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
