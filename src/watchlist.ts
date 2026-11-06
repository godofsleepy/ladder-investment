import { ensureAsset, type NewAssetHints } from "./assets.js";
import { daysBetween, today } from "./dates.js";
import type { Db } from "./db.js";
import { zoneDistance } from "./engine.js";
import { Decimal, idr, LadderError, parseAmount, pct, qty } from "./money.js";
import { loadHoldings } from "./portfolio.js";
import { latestPrices } from "./prices/store.js";

export type Priority = "high" | "medium" | "low";

interface ItemRow {
  id: number;
  asset_id: number;
  zone_low: string;
  zone_high: string;
  reason: string;
  priority: Priority;
  planned_amount_idr: string | null;
  alert: boolean;
  thesis_id: number | null;
  status: "watching" | "triggered" | "bought" | "dropped";
  drop_reason: string | null;
  added_at: string;
  closed_at: string | null;
  symbol: string;
  name: string;
  class: string;
  currency: string;
}

const ITEM_SQL = `select w.*, a.symbol, a.name, a.class, a.currency from watchlist w join assets a on a.id = w.asset_id`;

/** Moves open items between watching and triggered. Returns the ones that just entered their zone. */
export async function recomputeWatchlist(db: Db): Promise<Array<{ id: number; symbol: string; price: string }>> {
  const { rows } = await db.query<ItemRow>(`${ITEM_SQL} where w.status in ('watching','triggered')`);
  const prices = await latestPrices(db);
  const entered: Array<{ id: number; symbol: string; price: string }> = [];
  for (const item of rows) {
    const quote = prices.get(item.asset_id);
    if (!quote) continue;
    const { side } = zoneDistance(quote.close, new Decimal(item.zone_low), new Decimal(item.zone_high));
    const next = side === "inside" ? "triggered" : "watching";
    if (next === item.status) continue;
    // Leaving the zone clears the email marker, so the next entry is a new alert.
    await db.query("update watchlist set status = $2, notified_at = case when $2 = 'watching' then null else notified_at end where id = $1", [item.id, next]);
    if (next === "triggered") {
      entered.push({ id: item.id, symbol: item.symbol, price: quote.close.toString() });
    }
  }
  return entered;
}

function describe(item: ItemRow, price: { close: Decimal; date: string; stale: boolean } | undefined, owned: Decimal) {
  const distance = price
    ? zoneDistance(price.close, new Decimal(item.zone_low), new Decimal(item.zone_high))
    : null;
  return {
    id: item.id,
    symbol: item.symbol,
    name: item.name,
    class: item.class,
    added_at: item.added_at,
    status: item.status,
    price: price?.close.toString() ?? null,
    price_date: price?.date ?? null,
    price_stale: price?.stale ?? false,
    currency: item.currency,
    zone_low: item.zone_low,
    zone_high: item.zone_high,
    distance_pct: distance ? pct(distance.pct) : null,
    distance_side: distance?.side ?? null,
    distance: !distance
      ? "no price yet"
      : distance.side === "inside"
        ? "inside zone"
        : `${pct(distance.pct)}% ${distance.side} zone`,
    reason: item.reason,
    priority: item.priority,
    planned_amount_idr: item.planned_amount_idr ? idr(new Decimal(item.planned_amount_idr)) : null,
    alert: item.alert,
    thesis_id: item.thesis_id,
    days_on_list: daysBetween(item.added_at, item.closed_at ?? today()),
    owned_qty: qty(owned),
    drop_reason: item.drop_reason,
    closed_at: item.closed_at,
  };
}

export async function getItem(db: Db, id: number) {
  const { rows } = await db.query<ItemRow>(`${ITEM_SQL} where w.id = $1`, [id]);
  if (!rows[0]) throw new LadderError(`No watchlist item ${id}`);
  const prices = await latestPrices(db);
  const owned = (await loadHoldings(db)).find((h) => h.assetId === rows[0]?.asset_id)?.idr.qty;
  return describe(rows[0], prices.get(rows[0].asset_id), owned ?? new Decimal(0));
}

function assertZone(low: Decimal, high: Decimal): void {
  if (!low.greaterThan(0)) throw new LadderError("zone_low must be above zero");
  if (high.lessThan(low)) throw new LadderError("zone_high must be at or above zone_low");
}

export interface AddToWatchlist extends NewAssetHints {
  symbol: string;
  zone_low: string | number;
  zone_high?: string | number;
  reason: string;
  priority?: Priority;
  planned_amount?: string | number;
  alert?: boolean;
}

export async function addToWatchlist(db: Db, input: AddToWatchlist) {
  const low = parseAmount(input.zone_low, "zone_low");
  const high = input.zone_high === undefined ? low : parseAmount(input.zone_high, "zone_high");
  assertZone(low, high);
  if (input.reason.length > 140) throw new LadderError("reason must be 140 characters or fewer");

  const asset = await ensureAsset(db, input.symbol, input);
  const open = await db.query<{ id: number }>(
    "select id from watchlist where asset_id = $1 and status in ('watching','triggered')",
    [asset.id],
  );
  if (open.rows[0]) {
    throw new LadderError(`${asset.symbol} is already on the watchlist (item ${open.rows[0].id}): update that item`);
  }
  const draft = await db.query<{ id: number }>(
    "select id from theses where asset_id = $1 and status = 'draft'",
    [asset.id],
  );
  const { rows } = await db.query<{ id: number }>(
    `insert into watchlist (asset_id, zone_low, zone_high, reason, priority, planned_amount_idr, alert, thesis_id, added_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [
      asset.id,
      low.toString(),
      high.toString(),
      input.reason,
      input.priority ?? "medium",
      input.planned_amount === undefined ? null : parseAmount(input.planned_amount, "planned_amount").toString(),
      input.alert ?? true,
      draft.rows[0]?.id ?? null,
      today(),
    ],
  );
  return { assetId: asset.id, itemId: (rows[0] as { id: number }).id };
}

export async function readItem(db: Db, id: number) {
  await recomputeWatchlist(db);
  return getItem(db, id);
}

export async function getWatchlist(
  db: Db,
  filters: { status?: "active" | "history" | ItemRow["status"]; class?: string; priority?: Priority },
) {
  const status = filters.status ?? "active";
  const wanted =
    status === "active" ? ["watching", "triggered"] : status === "history" ? ["bought", "dropped"] : [status];
  const { rows } = await db.query<ItemRow>(
    `${ITEM_SQL} where w.status = any($1) and ($2::text is null or a.class = $2) and ($3::text is null or w.priority = $3)`,
    [wanted, filters.class ?? null, filters.priority ?? null],
  );
  const prices = await latestPrices(db);
  const holdings = await loadHoldings(db);
  const items = rows.map((item) =>
    describe(
      item,
      prices.get(item.asset_id),
      holdings.find((h) => h.assetId === item.asset_id)?.idr.qty ?? new Decimal(0),
    ),
  );
  const distance = (i: (typeof items)[number]) =>
    i.distance_pct === null ? Number.POSITIVE_INFINITY : Number(i.distance_pct);
  items.sort(
    (a, b) =>
      Number(b.status === "triggered") - Number(a.status === "triggered") || distance(a) - distance(b),
  );
  return { count: items.length, items };
}

export interface WatchlistChanges {
  zone_low?: string | number;
  zone_high?: string | number;
  reason?: string;
  priority?: Priority;
  planned_amount?: string | number;
  alert?: boolean;
  status?: "dropped";
  drop_reason?: string;
}

export async function updateWatchlistItem(db: Db, id: number, changes: WatchlistChanges) {
  const { rows } = await db.query<ItemRow>(`${ITEM_SQL} where w.id = $1`, [id]);
  const item = rows[0];
  if (!item) throw new LadderError(`No watchlist item ${id}`);
  if (item.status === "bought" || item.status === "dropped") {
    throw new LadderError(`Item ${id} is already ${item.status} and in history`);
  }
  if (changes.status === "dropped" && !changes.drop_reason) {
    throw new LadderError("Dropping an item needs a drop_reason");
  }
  const low = changes.zone_low === undefined ? new Decimal(item.zone_low) : parseAmount(changes.zone_low, "zone_low");
  const high = changes.zone_high === undefined ? new Decimal(item.zone_high) : parseAmount(changes.zone_high, "zone_high");
  assertZone(low, high);
  if (changes.reason && changes.reason.length > 140) {
    throw new LadderError("reason must be 140 characters or fewer");
  }
  await db.query(
    `update watchlist set zone_low = $2, zone_high = $3, reason = coalesce($4, reason),
       priority = coalesce($5, priority), planned_amount_idr = coalesce($6, planned_amount_idr),
       alert = coalesce($7, alert), status = coalesce($8, status), drop_reason = coalesce($9, drop_reason),
       closed_at = case when $8 = 'dropped' then $10::date else closed_at end
     where id = $1`,
    [
      id,
      low.toString(),
      high.toString(),
      changes.reason ?? null,
      changes.priority ?? null,
      changes.planned_amount === undefined ? null : parseAmount(changes.planned_amount, "planned_amount").toString(),
      changes.alert ?? null,
      changes.status ?? null,
      changes.drop_reason ?? null,
      today(),
    ],
  );
  await recomputeWatchlist(db);
  return getItem(db, id);
}
