import { today } from "@ladder/dates";
import Link from "next/link";
import { PageActions } from "@/components/PageActions";
import { TradeFilters } from "@/components/TradeFilters";
import { Empty } from "@/components/ui";
import { capitalize, fullDate, moneyOf, monthYear, nat, qf } from "@/lib/format";
import { assets, moneySetting, positions, tradeLog } from "@/lib/ladder";

const GRID = "grid grid-cols-[minmax(170px,1.6fr)_minmax(130px,1fr)_minmax(110px,.8fr)_minmax(110px,1fr)_minmax(110px,1fr)] gap-3";
const TONE: Record<string, string> = {
  buy: "text-good-strong hover:text-good-strong",
  dividend: "text-good-strong hover:text-good-strong",
  sell: "text-bad-strong hover:text-bad-strong",
};

type Entry = Awaited<ReturnType<typeof tradeLog>>["entries"][number];

function byMonth(entries: Entry[]) {
  const groups: Array<{ month: string; rows: Entry[] }> = [];
  for (const entry of entries) {
    const month = monthYear(entry.date);
    const last = groups.at(-1);
    if (last?.month === month) last.rows.push(entry);
    else groups.push({ month, rows: [entry] });
  }
  return groups;
}

export default async function TradesPage({ searchParams }: { searchParams: Promise<{ side?: string; asset?: string }> }) {
  const { side, asset } = await searchParams;
  const [log, options, base, { positions: open }] = await Promise.all([tradeLog({ side, symbol: asset }), assets(), moneySetting(), positions()]);
  const { money } = moneyOf(base);

  const summary = [
    `${log.entries.length} ${log.entries.length === 1 ? "entry" : "entries"}`,
    ...[["bought", log.totals.bought_idr], ["sold", log.totals.sold_idr], ["dividends", log.totals.dividends_idr]]
      .filter(([, value]) => Number(value) > 0)
      .map(([label, value]) => `${label} ${money(value)}`),
  ].join(" · ");

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[32px] font-bold tracking-[-0.6px]">Trade log</h1>
          <p className="m-0 text-[15px] text-ink-2">Buys, sells, dividends, deposits and fees, newest first. Avg cost and P&amp;L are worked out from these.</p>
        </div>
        <PageActions assets={options} today={today()} tradeDefault={open[0]?.symbol} only="trade" />
      </header>
      {!log.has_trades ? (
        <Empty title="No trades yet">Log one here, or tell your agent what you bought.</Empty>
      ) : (
        <>
          <TradeFilters side={log.side} symbol={log.symbol} symbols={log.symbols} summary={summary} />
          <section aria-label="Trades" className="card overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className={`${GRID} bg-fill px-5 py-3 text-right text-[13px] font-bold text-ink-2`}>
                  <span className="text-left">Action</span>
                  <span>Net amount</span>
                  <span>Qty</span>
                  <span>Price</span>
                  <span>Date</span>
                </div>
                {byMonth(log.entries).map((group) => (
                  <div key={group.month}>
                    <div className="border-t border-line-soft px-5 pt-3.5 pb-2 text-sm font-bold text-muted">{group.month}</div>
                    {group.rows.map((t) => (
                      <div key={t.id} className={`${GRID} items-center border-t border-line-soft px-5 py-3.5 text-right text-[15px] tabular-nums`}>
                        <Link href={`/assets/${encodeURIComponent(t.symbol)}?from=trades`} className={`justify-self-start text-left font-bold ${TONE[t.type] ?? ""}`}>
                          {capitalize(t.type)} {t.symbol}
                        </Link>
                        <span className="flex flex-col items-end gap-px">
                          <span>{nat(t.currency, t.net)}</span>
                          {t.currency !== base.currency ? <span className="text-xs text-muted">{money(t.net_idr)}</span> : null}
                        </span>
                        <span className="text-ink-2">{t.type === "fee" ? "" : qf(t.qty, t.symbol, t.class)}</span>
                        <span className="text-ink-2">{t.type === "fee" ? "" : nat(t.currency, t.price)}</span>
                        <span className="text-ink-2">{fullDate(t.date)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {log.entries.length === 0 ? <p className="m-0 border-t border-line-soft p-5 text-sm text-muted">Nothing matches these filters.</p> : null}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
