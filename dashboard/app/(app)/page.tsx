import { today } from "@ladder/dates";
import { GrowthChart } from "@/components/GrowthChart";
import { HoldingsTable } from "@/components/HoldingsTable";
import { PageActions } from "@/components/PageActions";
import { PositionAlerts } from "@/components/PositionAlerts";
import { PricesCard } from "@/components/PricesCard";
import { Empty, eyebrow } from "@/components/ui";
import { CLASSES, classLabel, moneyOf, pc, pct1, POSITION_BADGE, refreshedLabel } from "@/lib/format";
import { allocation, assets, growth, moneySetting, positions, priceStatus } from "@/lib/ladder";

export default async function PortfolioPage() {
  const [{ portfolio, positions: open }, alloc, history, options, base, prices] = await Promise.all([
    positions(),
    allocation(),
    growth(),
    assets(),
    moneySetting(),
    priceStatus(),
  ]);
  const { money, signed } = moneyOf(base);
  const t = portfolio.totals;
  const date = today();

  if (open.length === 0 && portfolio.closed_positions.length === 0) {
    return (
      <>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className={eyebrow}>Portfolio value</span>
            <span className="text-[40px] leading-[1.1] font-bold tracking-[-1px] tabular-nums">{money(0)}</span>
          </div>
          <PageActions assets={options} today={date} />
        </header>
        <Empty title="No holdings yet">
          Log your first trade here, or tell your agent what you own, for example: "I hold 0.01 BTC on Indodax at an average of 1.1B".
        </Empty>
      </>
    );
  }

  const groups = alloc.groups.map((g) => ({
    ...g,
    swatch: CLASSES.find((c) => c.key === g.group)?.swatch ?? "var(--color-fill-strong)",
    label: classLabel(g.group),
  }));
  let start = 0;
  const donut = `conic-gradient(${groups
    .map((g) => {
      const end = start + (Number(g.percent) / 100) * 360;
      const stop = Math.max(start, end - 1.5);
      const part = `${g.swatch} ${start}deg ${stop}deg, var(--color-surface) ${stop}deg ${end}deg`;
      start = end;
      return part;
    })
    .join(", ")})`;

  const alerts = open
    .filter((p) => p.state !== "ok" && !p.ignored)
    .sort((a, b) => POSITION_BADGE[a.state].rank - POSITION_BADGE[b.state].rank);
  const ignored = open.filter((p) => p.ignored);
  const loss = Number(t.unrealized_idr) < 0;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className={eyebrow}>Portfolio value</span>
          <span className="text-[40px] leading-[1.1] font-bold tracking-[-1px] tabular-nums">{money(t.value_idr)}</span>
          <span className="text-sm text-ink-2">
            <b className={`font-semibold tabular-nums ${loss ? "text-bad" : "text-good"}`}>{signed(t.unrealized_idr)} ({pct1(t.unrealized_pct)})</b> unrealised on {money(t.cost_idr)} invested
          </span>
        </div>
        <PageActions assets={options} today={date} tradeDefault={open[0]?.symbol} />
      </header>

      <GrowthChart points={history.points} symbols={history.symbols} base={base} />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
        <div className="card flex flex-col gap-4 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-[17px] font-bold">Allocation</h2>
            <span className="text-[13px] text-muted">By asset class</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex h-[152px] w-[152px] shrink-0 items-center justify-center rounded-full" style={{ background: donut }}>
              <div className="flex h-28 w-28 flex-col items-center justify-center gap-0.5 rounded-full bg-surface">
                <span className="text-[20px] font-bold tracking-[-0.4px] tabular-nums">{money(t.value_idr)}</span>
                <span className="text-xs text-muted">{open.length} {open.length === 1 ? "position" : "positions"}</span>
              </div>
            </div>
            <div className="flex min-w-[180px] flex-1 flex-col gap-2.5">
              {groups.map((g) => (
                <div key={g.group} className="grid grid-cols-[10px_minmax(0,1fr)_auto_44px] items-center gap-2.5 text-sm">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: g.swatch }} />
                  <span className="text-ink-2">{g.label}</span>
                  <span className="font-semibold tabular-nums">{money(g.value_idr)}</span>
                  <span className="text-right text-muted tabular-nums">{pc(g.percent)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <PositionAlerts alerts={alerts} ignored={ignored} />
      </section>

      <HoldingsTable positions={open} base={base} />

      {/* The sidebar holds this on wider screens. */}
      <div className="lg:hidden">
        <PricesCard
          refreshed={refreshedLabel(prices.refreshed_at)}
          fx={prices.usd_idr ? `Rp${Math.round(Number(prices.usd_idr)).toLocaleString("id-ID")}` : "Not fetched yet"}
        />
      </div>
    </>
  );
}
