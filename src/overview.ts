import { findAsset, requireAsset, type Asset } from "./assets.js";
import { addDays, daysBetween, today } from "./dates.js";
import type { Db } from "./db.js";
import { replay, type EngineTrade, type TradeType } from "./engine.js";
import { getMacroViews } from "./macro.js";
import { getWatchlist } from "./watchlist.js";
import { Decimal, LadderError, parseAmount, pct } from "./money.js";
import { getPortfolio } from "./portfolio.js";
import { HISTORY_DAYS } from "./prices/history.js";
import { FX_SYMBOL, latestPrices, priceHistory } from "./prices/store.js";
import { getTheses } from "./thesis.js";

export type PositionState = "alert" | "missing" | "review" | "ok";
export type PositionReason = "kill" | "cap" | "target" | "date" | "none" | "next";

/** Names one alert exactly, so ignoring it doesn't hide a new level or the next review. */
function alertKeyOf(reason: PositionReason, kill: unknown, cap: number | null, target: unknown, review: unknown): string {
  if (reason === "kill") return `kill:${kill}`;
  if (reason === "cap") return `cap:${cap}`;
  if (reason === "target") return `target:${target}`;
  if (reason === "date") return `date:${review}`;
  return reason;
}

/** What the Position alerts card and the Holdings table show for each open position. */
export async function getPositions(db: Db) {
  const portfolio = await getPortfolio(db);
  const theses = await getTheses(db, { status: "active" });
  const views = await getMacroViews(db);
  const bySymbol = new Map(theses.map((t) => [t.symbol, t]));
  const dismissed = await db.query<{ symbol: string; ignored_alert: string }>(
    "select symbol, ignored_alert from assets where ignored_alert is not null",
  );
  const ignoredBySymbol = new Map(dismissed.rows.map((r) => [r.symbol, r.ignored_alert]));

  const positions = portfolio.holdings.map((h) => {
    const thesis = bySymbol.get(h.symbol) ?? null;
    const weight = h.weight_pct === null ? null : Number(h.weight_pct);
    const cap = thesis?.max_weight_pct ? Number(thesis.max_weight_pct) : null;
    const triggers = thesis?.review_triggers ?? [];
    const has = (word: string) => triggers.some((t) => t.includes(word));

    let state: PositionState = "ok";
    let reason: PositionReason = "next";
    if (!thesis) [state, reason] = ["missing", "none"];
    else if (has("kill price")) [state, reason] = ["alert", "kill"];
    else if (cap !== null && weight !== null && weight > cap) [state, reason] = ["alert", "cap"];
    else if (has("Review date")) [state, reason] = ["review", "date"];
    else if (has("target")) [state, reason] = ["review", "target"];

    // The narrowest view says most about this holding, so it wins when several apply.
    const macro = views
      .filter((v) => v.symbols.includes(h.symbol))
      .sort((a, b) => a.symbols.length - b.symbols.length)[0];

    const alertKey = state === "ok" ? null : alertKeyOf(reason, thesis?.kill_price, cap, thesis?.target_price, thesis?.next_review);

    return {
      ...h,
      state,
      reason,
      alert_key: alertKey,
      ignored: alertKey !== null && ignoredBySymbol.get(h.symbol) === alertKey,
      kill_price: thesis?.kill_price ?? null,
      target_price: thesis?.target_price ?? null,
      cap_pct: cap,
      next_review: thesis?.next_review ?? null,
      macro: macro ? { short_name: macro.short_name, state: macro.state } : null,
    };
  });
  return { portfolio, positions };
}

export async function ignoreAlert(db: Db, symbol: string): Promise<void> {
  const { positions } = await getPositions(db);
  const position = positions.find((p) => p.symbol === symbol);
  if (!position?.alert_key) throw new LadderError(`${symbol} has no alert to ignore`);
  await db.query("update assets set ignored_alert = $2 where symbol = $1", [symbol, position.alert_key]);
}

export async function restoreAlert(db: Db, symbol: string): Promise<void> {
  await db.query("update assets set ignored_alert = null where symbol = $1", [symbol]);
}

/** Daily closes for the asset page, and whether its long history still has to be fetched. */
export async function getPriceChart(db: Db, symbol: string) {
  const asset = await requireAsset(db, symbol);
  const rows = await priceHistory(db, asset.id, HISTORY_DAYS);
  return {
    points: rows.map((r) => ({ date: r.date, close: Number(r.close) })),
    needs_history: asset.price_source !== "manual" && !asset.history_filled_at,
  };
}

/** One macro view with every asset linked to it, held or not, and what each means for you. */
export async function getMacroView(db: Db, id: number) {
  const view = (await getMacroViews(db)).find((v) => v.id === id);
  if (!view) throw new LadderError(`No macro view ${id}`);
  const { rows: linked } = await db.query<{ id: number; symbol: string; name: string; class: string; currency: string }>(
    `select a.id, a.symbol, a.name, a.class, a.currency from macro_holdings m join assets a on a.id = m.asset_id
     where m.view_id = $1 order by a.symbol`,
    [id],
  );
  const { positions } = await getPositions(db);
  const watch = await getWatchlist(db, {});
  const prices = await latestPrices(db);
  const exposure = new Decimal(view.exposure_idr);

  const assets = linked.map((a) => {
    const p = positions.find((x) => x.symbol === a.symbol) ?? null;
    const w = watch.items.find((i) => i.symbol === a.symbol) ?? null;
    return {
      symbol: a.symbol,
      name: a.name,
      class: a.class,
      currency: a.currency,
      price: p?.price ?? prices.get(a.id)?.close.toString() ?? null,
      position: p,
      share_pct: p?.value_idr && !exposure.isZero() ? pct(new Decimal(p.value_idr).div(exposure).times(100)) : null,
      watch: w
        ? { id: w.id, zone_low: w.zone_low, zone_high: w.zone_high, distance_side: w.distance_side, distance_pct: w.distance_pct }
        : null,
    };
  });
  // What you hold comes first, biggest first, then what you only follow.
  assets.sort((x, y) => Number(y.position?.value_idr ?? -1) - Number(x.position?.value_idr ?? -1) || x.symbol.localeCompare(y.symbol));
  return { ...view, assets };
}

const STEP_AFTER_DAYS = 180;

interface TradeRow {
  id: number;
  asset_id: number;
  type: TradeType;
  qty: string;
  price: string;
  fee: string;
  currency: string;
  fx_to_idr: string;
  traded_at: string;
  symbol: string;
  asset_currency: string;
}

const toEngine = (r: TradeRow, fx?: Decimal): EngineTrade => ({
  id: r.id,
  type: r.type,
  qty: new Decimal(r.qty),
  price: new Decimal(r.price),
  fee: new Decimal(r.fee),
  fx: fx ?? new Decimal(r.fx_to_idr),
  date: r.traded_at,
});

/** The last value on or before `date`, from a date-sorted series. */
function lastOn(series: Array<{ date: string; close: number }> | undefined, date: string): number | null {
  if (!series) return null;
  let found: number | null = null;
  for (const point of series) {
    if (point.date > date) break;
    found = point.close;
  }
  return found;
}

export interface GrowthPoint {
  date: string;
  value: number;
  invested: number;
  by: Record<string, number | null>;
}

/**
 * Portfolio value and money invested over time, in IDR, from real trades and stored
 * closes. A day with no stored close uses the latest earlier one, then the trade price.
 */
export async function getGrowth(db: Db): Promise<{ points: GrowthPoint[]; symbols: string[] }> {
  const { rows: trades } = await db.query<TradeRow>(
    `select t.id, t.asset_id, t.type, t.qty, t.price, t.fee, t.currency, t.fx_to_idr, t.traded_at,
       a.symbol, a.currency as asset_currency
     from trades t join assets a on a.id = t.asset_id order by t.traded_at, t.id`,
  );
  const first = trades[0]?.traded_at;
  if (!first) return { points: [], symbols: [] };

  const closes = await db.query<{ asset_id: number; date: string; close: string }>(
    "select asset_id, date, close from prices where date >= $1 order by asset_id, date",
    [addDays(first, -10)],
  );
  const series = new Map<number, Array<{ date: string; close: number }>>();
  for (const row of closes.rows) {
    const list = series.get(row.asset_id) ?? [];
    list.push({ date: row.date, close: Number(row.close) });
    series.set(row.asset_id, list);
  }
  const fxAsset = await db.query<{ id: number }>("select id from assets where symbol = $1", [FX_SYMBOL]);
  const fx = series.get(fxAsset.rows[0]?.id ?? -1);

  const byAsset = new Map<number, TradeRow[]>();
  for (const trade of trades) byAsset.set(trade.asset_id, [...(byAsset.get(trade.asset_id) ?? []), trade]);

  const date = today();
  const span = daysBetween(first, date);
  const step = span > STEP_AFTER_DAYS ? 7 : 1;
  const dates: string[] = [];
  for (let d = first; d < date; d = addDays(d, step)) dates.push(d);
  dates.push(date);

  // Sold assets still count towards past value, but only what's held today gets its own line.
  const symbols = [...byAsset.values()]
    .filter((list) => !replay(list.map((t) => toEngine(t))).qty.isZero())
    .map((list) => (list[0] as TradeRow).symbol);
  const heldNow = new Set(symbols);
  const points = dates.map((day) => {
    let value = 0;
    let invested = 0;
    const by: Record<string, number | null> = {};
    for (const [assetId, list] of byAsset) {
      const held = list.filter((t) => t.traded_at <= day);
      const symbol = (list[0] as TradeRow).symbol;
      if (heldNow.has(symbol)) by[symbol] = null;
      if (held.length === 0) continue;
      const position = replay(held.map((t) => toEngine(t)));
      invested += position.cost.toNumber();
      if (position.qty.isZero()) continue;
      const last = held.at(-1) as TradeRow;
      const native = (list[0] as TradeRow).asset_currency;
      const close = lastOn(series.get(assetId), day) ?? (last.currency === native ? Number(last.price) : null);
      const rate = native === "IDR" ? 1 : (lastOn(fx, day) ?? Number(last.fx_to_idr));
      if (close === null) continue;
      const assetValue = position.qty.toNumber() * close * rate;
      if (heldNow.has(symbol)) by[symbol] = Math.round(assetValue);
      value += assetValue;
    }
    return { date: day, value: Math.round(value), invested: Math.round(invested), by };
  });
  return { points, symbols };
}

/** When prices were last fetched, and today's USD/IDR. */
export async function getPriceStatus(db: Db) {
  const { rows } = await db.query<{ at: Date | null }>("select max(updated_at) as at from prices");
  const fxAsset = await db.query<{ id: number }>("select id from assets where symbol = $1", [FX_SYMBOL]);
  const fx = (await latestPrices(db)).get(fxAsset.rows[0]?.id ?? -1);
  return { refreshed_at: rows[0]?.at ?? null, usd_idr: fx ? fx.close.toString() : null };
}

/** What a trade would do, computed by the same engine that records it. Nothing is saved. */
export async function previewTrade(
  db: Db,
  input: { symbol: string; side: "buy" | "sell"; qty: string | number; price: string | number; fee?: string | number },
) {
  const qty = parseAmount(input.qty, "Quantity");
  const price = parseAmount(input.price, "Price");
  const fee = input.fee === undefined || input.fee === "" ? new Decimal(0) : parseAmount(input.fee, "Fee");
  if (!qty.greaterThan(0) || !price.greaterThan(0)) return null;

  const asset: Asset | undefined = await findAsset(db, input.symbol);
  const { rows } = asset
    ? await db.query<TradeRow>("select * from trades where asset_id = $1", [asset.id])
    : { rows: [] as TradeRow[] };
  const one = new Decimal(1);
  const past = rows.map((r) => toEngine(r, one));
  const before = replay(past);
  if (input.side === "sell" && qty.greaterThan(before.qty)) {
    throw new LadderError(`You hold ${before.qty.toString()}.`);
  }
  const after = replay([
    ...past,
    { id: Number.MAX_SAFE_INTEGER, type: input.side, qty, price, fee, fx: one, date: today() },
  ]);
  const gross = qty.times(price);
  return input.side === "buy"
    ? { side: "buy" as const, total: gross.plus(fee).toString(), qty: after.qty.toString(), avg: after.avgCost.toString() }
    : {
        side: "sell" as const,
        proceeds: gross.minus(fee).toString(),
        qty: after.qty.toString(),
        realized: after.realizedTrading.minus(before.realizedTrading).toString(),
      };
}

export async function assetOptions(db: Db) {
  const { rows } = await db.query<Asset>("select * from assets where class <> 'fx' order by symbol");
  const prices = await latestPrices(db);
  return rows.map((a) => ({
    symbol: a.symbol,
    name: a.name,
    class: a.class,
    currency: a.currency,
    price: prices.get(a.id)?.close.toString() ?? null,
  }));
}

export { requireAsset };
