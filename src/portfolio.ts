import { today } from "./dates.js";
import type { Db } from "./db.js";
import { replay, type EngineTrade, type Position, type TradeType } from "./engine.js";
import { Decimal, idr, LadderError, pct, qty } from "./money.js";
import { FX_SYMBOL, latestPrices } from "./prices/store.js";

interface TradeRow {
  id: number;
  asset_id: number;
  type: TradeType;
  qty: string;
  price: string;
  fee: string;
  currency: string;
  fx_to_idr: string;
  platform: string | null;
  traded_at: string;
  symbol: string;
  name: string;
  class: string;
  asset_currency: string;
}

export interface Holding {
  assetId: number;
  symbol: string;
  name: string;
  class: string;
  currency: string;
  idr: Position;
  /** Average cost in the asset's currency; null when trades mix currencies. */
  nativeAvgCost: Decimal | null;
  platformQty: Map<string, Decimal>;
  price: Decimal | null;
  priceDate: string | null;
  stale: boolean;
  valueIdr: Decimal | null;
  unrealizedIdr: Decimal | null;
  unrealizedPct: Decimal | null;
}

function toEngine(row: TradeRow, useFx: boolean): EngineTrade {
  return {
    id: row.id,
    type: row.type,
    qty: new Decimal(row.qty),
    price: new Decimal(row.price),
    fee: new Decimal(row.fee),
    fx: useFx ? new Decimal(row.fx_to_idr) : new Decimal(1),
    date: row.traded_at,
  };
}

/** Throws if the asset's trades, with any change applied, would ever go below zero. */
export async function assertTradesValid(db: Db, assetId: number): Promise<Position> {
  const { rows } = await db.query<TradeRow>("select * from trades where asset_id = $1", [assetId]);
  return replay(rows.map((r) => toEngine(r, true)));
}

export async function loadHoldings(db: Db, asOf: string = today()): Promise<Holding[]> {
  const { rows } = await db.query<TradeRow>(
    `select t.*, a.symbol, a.name, a.class, a.currency as asset_currency
     from trades t join assets a on a.id = t.asset_id
     where t.traded_at <= $1`,
    [asOf],
  );
  const prices = await latestPrices(db, asOf);
  const fxAsset = await db.query<{ id: number }>("select id from assets where symbol = $1", [FX_SYMBOL]);
  const fx = prices.get(fxAsset.rows[0]?.id ?? -1);

  const byAsset = new Map<number, TradeRow[]>();
  for (const row of rows) {
    const list = byAsset.get(row.asset_id);
    if (list) list.push(row);
    else byAsset.set(row.asset_id, [row]);
  }

  const holdings: Holding[] = [];
  for (const [assetId, trades] of byAsset) {
    const first = trades[0] as TradeRow;
    const position = replay(trades.map((t) => toEngine(t, true)));
    const sameCurrency = trades.every((t) => t.currency === first.asset_currency);
    const nativeAvgCost = sameCurrency ? replay(trades.map((t) => toEngine(t, false))).avgCost : null;

    const platformQty = new Map<string, Decimal>();
    for (const t of trades) {
      if (t.type !== "buy" && t.type !== "sell" && t.type !== "deposit") continue;
      const key = t.platform ?? "unknown";
      const delta = new Decimal(t.qty).times(t.type === "sell" ? -1 : 1);
      platformQty.set(key, (platformQty.get(key) ?? new Decimal(0)).plus(delta));
    }

    const quote = prices.get(assetId);
    const rate = first.asset_currency === "IDR" ? new Decimal(1) : (fx?.close ?? null);
    const valueIdr = quote && rate ? position.qty.times(quote.close).times(rate) : null;
    const unrealizedIdr = valueIdr ? valueIdr.minus(position.cost) : null;

    holdings.push({
      assetId,
      symbol: first.symbol,
      name: first.name,
      class: first.class,
      currency: first.asset_currency,
      idr: position,
      nativeAvgCost,
      platformQty,
      price: quote?.close ?? null,
      priceDate: quote?.date ?? null,
      stale: quote?.stale ?? false,
      valueIdr,
      unrealizedIdr,
      unrealizedPct:
        unrealizedIdr && !position.cost.isZero() ? unrealizedIdr.div(position.cost).times(100) : null,
    });
  }
  return holdings;
}

export function formatPosition(h: Holding) {
  return {
    symbol: h.symbol,
    name: h.name,
    class: h.class,
    qty: qty(h.idr.qty),
    price: h.price?.toString() ?? null,
    price_currency: h.currency,
    price_date: h.priceDate,
    price_stale: h.stale,
    avg_cost: h.nativeAvgCost?.toDecimalPlaces(8).toString() ?? null,
    avg_cost_idr: idr(h.idr.avgCost),
    cost_idr: idr(h.idr.cost),
    value_idr: h.valueIdr ? idr(h.valueIdr) : null,
    unrealized_idr: h.unrealizedIdr ? idr(h.unrealizedIdr) : null,
    unrealized_pct: h.unrealizedPct ? pct(h.unrealizedPct) : null,
    realized_idr: idr(h.idr.realized),
    platforms: Object.fromEntries([...h.platformQty].map(([k, v]) => [k, qty(v)])),
  };
}

export async function getPortfolio(db: Db, asOf: string = today()) {
  const holdings = await loadHoldings(db, asOf);
  const theses = await db.query<{ asset_id: number; id: number; title: string }>(
    "select asset_id, id, title from theses where status = 'active'",
  );
  const thesisByAsset = new Map(theses.rows.map((t) => [t.asset_id, t]));

  const open = holdings.filter((h) => h.idr.qty.greaterThan(0));
  const closed = holdings.filter((h) => h.idr.qty.isZero());
  const priced = open.filter((h) => h.valueIdr);
  const sum = (values: Decimal[]) => values.reduce((a, b) => a.plus(b), new Decimal(0));

  const value = sum(priced.map((h) => h.valueIdr as Decimal));
  const cost = sum(priced.map((h) => h.idr.cost));
  const realized = sum(holdings.map((h) => h.idr.realized));
  const unrealized = value.minus(cost);

  const warnings: string[] = [];
  for (const h of open) {
    if (!h.valueIdr) warnings.push(`${h.symbol} has no price, so it is left out of the totals`);
    else if (h.stale) warnings.push(`${h.symbol} price is stale (from ${h.priceDate})`);
    if (!thesisByAsset.has(h.assetId)) warnings.push(`${h.symbol}: no thesis`);
  }

  return {
    as_of: asOf,
    base_currency: "IDR",
    totals: {
      value_idr: idr(value),
      cost_idr: idr(cost),
      unrealized_idr: idr(unrealized),
      unrealized_pct: cost.isZero() ? null : pct(unrealized.div(cost).times(100)),
      realized_idr: idr(realized),
      total_pnl_idr: idr(unrealized.plus(realized)),
    },
    holdings: open
      .sort((a, b) => (b.valueIdr ?? new Decimal(0)).comparedTo(a.valueIdr ?? new Decimal(0)))
      .map((h) => {
        const thesis = thesisByAsset.get(h.assetId);
        return {
          ...formatPosition(h),
          weight_pct: h.valueIdr && !value.isZero() ? pct(h.valueIdr.div(value).times(100)) : null,
          thesis: thesis ? { id: thesis.id, title: thesis.title } : null,
        };
      }),
    closed_positions: closed.map((h) => ({ symbol: h.symbol, realized_idr: idr(h.idr.realized) })),
    warnings,
  };
}

export type AllocationGroup = "class" | "platform" | "currency";

export async function getAllocation(db: Db, groupBy: AllocationGroup) {
  const asOf = today();
  const holdings = (await loadHoldings(db, asOf)).filter((h) => h.idr.qty.greaterThan(0));
  const groups = new Map<string, Decimal>();
  const warnings: string[] = [];
  const add = (key: string, amount: Decimal) =>
    groups.set(key, (groups.get(key) ?? new Decimal(0)).plus(amount));

  for (const h of holdings) {
    if (!h.valueIdr) {
      warnings.push(`${h.symbol} has no price, so it is left out`);
      continue;
    }
    if (groupBy === "class") add(h.class, h.valueIdr);
    else if (groupBy === "currency") add(h.currency, h.valueIdr);
    else {
      for (const [platform, held] of h.platformQty) {
        if (held.lessThan(0)) {
          warnings.push(`${h.symbol} shows ${held.toString()} on ${platform}: a sell is logged on a platform that never bought it`);
        }
        add(platform, held.div(h.idr.qty).times(h.valueIdr));
      }
    }
  }

  const total = [...groups.values()].reduce((a, b) => a.plus(b), new Decimal(0));
  return {
    as_of: asOf,
    group_by: groupBy,
    total_idr: idr(total),
    groups: [...groups]
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([group, value]) => ({
        group,
        value_idr: idr(value),
        percent: total.isZero() ? "0.00" : pct(value.div(total).times(100)),
      })),
    warnings,
  };
}

export async function holdingFor(db: Db, assetId: number): Promise<Holding | undefined> {
  return (await loadHoldings(db)).find((h) => h.assetId === assetId);
}

export function assertPositive(value: Decimal, label: string): void {
  if (!value.greaterThan(0)) throw new LadderError(`${label} must be above zero`);
}

/** Guardian holds cash and is a separate connector, so the agent passes its figure in. */
export async function getNetWorth(db: Db, guardianCash: Decimal) {
  const portfolio = await getPortfolio(db);
  const assets = new Decimal(portfolio.totals.value_idr);
  const total = assets.plus(guardianCash);
  return {
    as_of: portfolio.as_of,
    net_worth_idr: idr(total),
    guardian_cash_idr: idr(guardianCash),
    ladder_assets_idr: idr(assets),
    assets_share_pct: total.isZero() ? null : pct(assets.div(total).times(100)),
    warnings: portfolio.warnings,
  };
}
