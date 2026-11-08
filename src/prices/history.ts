import { requireAsset, type Asset } from "../assets.js";
import { addDays, daysBetween, today } from "../dates.js";
import type { Db } from "../db.js";
import { Decimal, LadderError } from "../money.js";
import { feedError, GOLD_YAHOO_SYMBOL, goldPerGramIdr, yahooHistory, type DailyClose } from "./feeds.js";
import { FX_SYMBOL } from "./store.js";

/** A gap this short is a weekend or holiday around the first trade, not missing history. */
const GAP_DAYS = 5;
/** How far back the asset page's price chart goes. */
export const HISTORY_DAYS = 1826;

async function keep(db: Db, asset: Pick<Asset, "id" | "currency">, closes: DailyClose[], source: string): Promise<void> {
  for (const { date, close } of closes) {
    // Never overwrite: a stored close may be a live refresh or a manual price.
    await db.query(
      `insert into prices (asset_id, date, close, currency, source) values ($1,$2,$3,$4,$5)
       on conflict (asset_id, date) do nothing`,
      [asset.id, date, close.toString(), asset.currency, source],
    );
  }
}

function nearest(series: DailyClose[], date: string): Decimal | null {
  let found: Decimal | null = null;
  for (const point of series) {
    if (point.date > date) break;
    found = point.close;
  }
  return found;
}

/** Fetches one asset's closes from its feed and stores them in the asset's currency. */
async function fetchCloses(db: Db, asset: Asset, fx: DailyClose[], from: string, to: string): Promise<void> {
  if (asset.price_source === "yahoo") {
    await keep(db, asset, await yahooHistory(asset.source_id ?? asset.symbol, from, to), "yahoo");
    return;
  }
  const usd = await yahooHistory(asset.price_source === "xau" ? GOLD_YAHOO_SYMBOL : `${asset.symbol}-USD`, from, to);
  const inIdr: DailyClose[] = [];
  for (const point of usd) {
    const rate = nearest(fx, point.date);
    if (!rate) continue;
    const close = asset.price_source === "xau" ? goldPerGramIdr(point.close, rate) : point.close.times(rate);
    inIdr.push({ date: point.date, close: close.toDecimalPlaces(2) });
  }
  await keep(db, asset, inIdr, asset.price_source);
}

/** Fills the price chart's history for one asset, held or not. Stored closes are left alone. */
export async function fillAssetHistory(db: Db, symbol: string): Promise<void> {
  const asset = await requireAsset(db, symbol);
  if (asset.price_source === "manual") return;
  const date = today();
  const from = addDays(date, -HISTORY_DAYS);
  try {
    let fx: DailyClose[] = [];
    if (asset.price_source !== "yahoo") {
      const fxRow = await db.query<Asset>("select * from assets where symbol = $1", [FX_SYMBOL]);
      const fxAsset = fxRow.rows[0] as Asset;
      fx = await yahooHistory(fxAsset.source_id as string, addDays(from, -7), date);
      await keep(db, fxAsset, fx, "yahoo");
    }
    await fetchCloses(db, asset, fx, from, date);
  } catch (err) {
    throw new LadderError(`Couldn't fetch ${asset.symbol}'s price history: ${feedError(err)}`);
  }
  await db.query("update assets set history_filled_at = now() where id = $1", [asset.id]);
}

/** Fetches daily closes back to each asset's first trade or macro view, so growth and view changes show what really happened. */
export async function fillHistory(db: Db): Promise<{ filled: string[]; failed: string[] }> {
  const { rows } = await db.query<Asset & { first_trade: string; earliest: string | null }>(
    `select a.*, min(need.d) as first_trade,
       (select min(p.date) from prices p where p.asset_id = a.id) as earliest
     from assets a
     join (
       select asset_id, traded_at as d from trades
       union all
       select m.asset_id, (v.created_at at time zone 'Asia/Jakarta')::date as d
       from macro_holdings m join macro_views v on v.id = m.view_id
     ) need on need.asset_id = a.id
     where a.price_source <> 'manual'
     group by a.id`,
  );
  const date = today();
  const stale = rows.filter((a) => !a.earliest || daysBetween(a.first_trade, a.earliest) > GAP_DAYS);
  const filled: string[] = [];
  const failed: string[] = [];
  if (stale.length === 0) return { filled, failed };

  const oldest = stale.map((a) => a.first_trade).sort()[0] as string;
  const fxRow = await db.query<Asset>("select * from assets where symbol = $1", [FX_SYMBOL]);
  const fxAsset = fxRow.rows[0] as Asset;
  let fx: DailyClose[] = [];
  try {
    fx = await yahooHistory(fxAsset.source_id as string, addDays(oldest, -7), date);
    await keep(db, fxAsset, fx, "yahoo");
  } catch {
    failed.push(FX_SYMBOL);
  }

  for (const asset of stale) {
    const from = addDays(asset.first_trade, -7);
    const to = asset.earliest ?? date;
    try {
      await fetchCloses(db, asset, fx, from, to);
      filled.push(asset.symbol);
    } catch {
      failed.push(asset.symbol);
    }
  }
  return { filled, failed };
}
