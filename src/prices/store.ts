import type { Asset } from "../assets.js";
import { requireAsset } from "../assets.js";
import { addDays, today } from "../dates.js";
import type { Db } from "../db.js";
import { Decimal, LadderError } from "../money.js";
import { feedError, yahooCloseOn } from "./feeds.js";

export const FX_SYMBOL = "USDIDR";
const STALE_AFTER_DAYS = 4;

export interface LatestPrice {
  close: Decimal;
  date: string;
  stale: boolean;
}

export async function savePrice(
  db: Db,
  asset: Pick<Asset, "id" | "currency">,
  date: string,
  close: Decimal,
  source: string,
): Promise<void> {
  await db.query(
    `insert into prices (asset_id, date, close, currency, source) values ($1,$2,$3,$4,$5)
     on conflict (asset_id, date) do update set close = excluded.close, source = excluded.source, updated_at = now()`,
    [asset.id, date, close.toString(), asset.currency, source],
  );
}

/** Newest price per asset on or before `asOf`. */
export async function latestPrices(db: Db, asOf: string = today()): Promise<Map<number, LatestPrice>> {
  const { rows } = await db.query<{ asset_id: number; close: string; date: string }>(
    `select distinct on (asset_id) asset_id, close, date from prices
     where date <= $1 order by asset_id, date desc`,
    [asOf],
  );
  const cutoff = addDays(asOf, -STALE_AFTER_DAYS);
  return new Map(
    rows.map((r) => [
      r.asset_id,
      { close: new Decimal(r.close), date: r.date, stale: r.date < cutoff },
    ]),
  );
}

/** USD/IDR for a trade date, from stored prices or else fetched and stored. */
export async function usdIdrOn(db: Db, date: string): Promise<Decimal> {
  const fx = await requireAsset(db, FX_SYMBOL);
  const { rows } = await db.query<{ close: string }>(
    "select close from prices where asset_id = $1 and date <= $2 and date >= $3 order by date desc limit 1",
    [fx.id, date, addDays(date, -7)],
  );
  if (rows[0]) return new Decimal(rows[0].close);
  try {
    const close = await yahooCloseOn(fx.source_id as string, date);
    await savePrice(db, fx, date, close, "yahoo");
    return close;
  } catch (err) {
    throw new LadderError(
      `No USD/IDR rate for ${date} (${feedError(err)}). Pass fx_rate with the rate you paid.`,
    );
  }
}

export async function priceHistory(db: Db, assetId: number, days = 365) {
  const { rows } = await db.query<{ date: string; close: string }>(
    "select date, close from prices where asset_id = $1 and date >= $2 order by date",
    [assetId, addDays(today(), -days)],
  );
  return rows;
}
