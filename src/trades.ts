import { parse } from "csv-parse/sync";
import { ensureAsset, findAsset, requireAsset, type NewAssetHints } from "./assets.js";
import { assertDate, today } from "./dates.js";
import type { Db, Tx } from "./db.js";
import type { TradeType } from "./engine.js";
import { Decimal, LadderError, parseAmount, qty as fmtQty } from "./money.js";
import { assertTradesValid, formatPosition, holdingFor } from "./portfolio.js";
import { fillHistory } from "./prices/history.js";
import { ensurePrice } from "./prices/refresh.js";
import { usdIdrOn } from "./prices/store.js";

export interface LogTrade extends NewAssetHints {
  symbol: string;
  type: TradeType;
  qty?: string | number;
  price?: string | number;
  fee?: string | number;
  fee_pct?: string | number;
  platform?: string;
  date?: string;
  trade_currency?: "IDR" | "USD";
  fx_rate?: string | number;
  note?: string;
}

const TRADE_KEYS = new Set(["buy", "sell", "dividend", "fee", "deposit"]);

function normalizeTrade(input: LogTrade) {
  if (!TRADE_KEYS.has(input.type)) throw new LadderError(`Unknown trade type "${input.type}"`);
  const date = assertDate(input.date ?? today());
  if (date > today()) throw new LadderError(`Trade date ${date} is in the future`);

  const amount = input.qty === undefined ? new Decimal(0) : parseAmount(input.qty, "qty");
  const price = input.price === undefined ? new Decimal(0) : parseAmount(input.price, "price");
  if (input.fee !== undefined && input.fee_pct !== undefined) {
    throw new LadderError("Pass fee or fee_pct, not both");
  }
  const fee =
    input.fee_pct !== undefined
      ? amount.times(price).times(parseAmount(input.fee_pct, "fee_pct")).div(100)
      : input.fee === undefined
        ? new Decimal(0)
        : parseAmount(input.fee, "fee");

  if (input.type === "fee") {
    if (!fee.greaterThan(0)) throw new LadderError("A fee entry needs a fee amount");
  } else if (!amount.greaterThan(0)) {
    throw new LadderError("qty must be above zero");
  }
  if ((input.type === "buy" || input.type === "sell" || input.type === "dividend") && !price.greaterThan(0)) {
    throw new LadderError("price must be above zero");
  }
  return { date, amount, price, fee };
}

async function saveTrade(db: Db, input: LogTrade) {
  const { date, amount, price, fee } = normalizeTrade(input);
  const asset = await ensureAsset(db, input.symbol, input);
  const currency = input.trade_currency ?? asset.currency;
  const fx =
    currency === "IDR"
      ? new Decimal(1)
      : input.fx_rate !== undefined
        ? parseAmount(input.fx_rate, "fx_rate")
        : await usdIdrOn(db, date);

  const { rows } = await db.query<{ id: number }>(
    `insert into trades (asset_id, type, qty, price, fee, currency, fx_to_idr, platform, traded_at, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [
      asset.id,
      input.type,
      amount.toString(),
      price.toString(),
      fee.toString(),
      currency,
      fx.toString(),
      input.platform ?? null,
      date,
      input.note ?? null,
    ],
  );
  await assertTradesValid(db, asset.id);
  return { tradeId: (rows[0] as { id: number }).id, asset, date, amount, price, fee, currency, fx };
}

/** The buy and sell side effects from the PRD lifecycle. */
async function applyLifecycle(db: Db, assetId: number, symbol: string, type: TradeType, date: string, heldAfter: Decimal) {
  const prompts: string[] = [];
  const result: { watchlist_bought?: number; thesis_activated?: number } = {};

  if (type === "buy") {
    const item = await db.query<{ id: number }>(
      `update watchlist set status = 'bought', closed_at = $3
       where asset_id = $1 and status in ('watching','triggered') and added_at <= $2 returning id`,
      [assetId, date, today()],
    );
    if (item.rows[0]) result.watchlist_bought = item.rows[0].id;

    const active = await db.query<{ id: number; title: string }>(
      "select id, title from theses where asset_id = $1 and status = 'active'",
      [assetId],
    );
    if (active.rows[0]) {
      prompts.push(`Added to the position under thesis "${active.rows[0].title}". Offer to add a note on why.`);
    } else {
      const draft = await db.query<{ id: number }>(
        `update theses set status = 'active', opened_at = $2
         where asset_id = $1 and status = 'draft' returning id`,
        [assetId, date],
      );
      if (draft.rows[0]) {
        result.thesis_activated = draft.rows[0].id;
        prompts.push("The draft thesis is now active. Confirm it still reflects why this was bought.");
      } else {
        prompts.push(`${symbol} has no thesis. Ask why it was bought, the kill criteria and a review date, then call save_thesis.`);
      }
    }
  }

  if (type === "sell" && heldAfter.isZero()) {
    const active = await db.query<{ id: number }>(
      "select id from theses where asset_id = $1 and status = 'active'",
      [assetId],
    );
    if (active.rows[0]) {
      prompts.push(`The ${symbol} position is fully sold. Ask how thesis ${active.rows[0].id} ended, then call close_thesis.`);
    }
  }
  return { ...result, prompts };
}

export async function logTrade(tx: Tx, input: LogTrade) {
  return tx(async (db) => {
    const saved = await saveTrade(db, input);
    const holding = await holdingFor(db, saved.asset.id);
    const heldAfter = holding?.idr.qty ?? new Decimal(0);
    const lifecycle = await applyLifecycle(db, saved.asset.id, saved.asset.symbol, input.type, saved.date, heldAfter);
    return {
      trade: {
        id: saved.tradeId,
        symbol: saved.asset.symbol,
        type: input.type,
        qty: fmtQty(saved.amount),
        price: saved.price.toString(),
        fee: saved.fee.toDecimalPlaces(8).toString(),
        currency: saved.currency,
        fx_to_idr: saved.fx.toString(),
        platform: input.platform ?? null,
        date: saved.date,
      },
      position: holding ? formatPosition(holding) : null,
      ...lifecycle,
    };
  });
}

/** After a trade is saved: an asset's first price and history. A feed failure never undoes the trade. */
export async function settleTrade(tx: Tx, symbol: string): Promise<void> {
  try {
    await tx(async (db) => {
      const asset = await findAsset(db, symbol);
      if (asset) await ensurePrice(db, asset.id);
      await fillHistory(db);
    });
  } catch {
    // Refresh prices will pick it up.
  }
}

export async function deleteTrade(tx: Tx, tradeId: number) {
  return tx(async (db) => {
    const { rows } = await db.query<{ asset_id: number; type: string; qty: string; price: string; traded_at: string }>(
      "delete from trades where id = $1 returning asset_id, type, qty, price, traded_at",
      [tradeId],
    );
    const removed = rows[0];
    if (!removed) throw new LadderError(`No trade ${tradeId}`);
    await assertTradesValid(db, removed.asset_id).catch((err: unknown) => {
      throw new LadderError(
        `Can't delete trade ${tradeId}: a later sell depends on it (${err instanceof Error ? err.message : err})`,
      );
    });
    const holding = await holdingFor(db, removed.asset_id);
    return { deleted: { id: tradeId, ...removed }, position: holding ? formatPosition(holding) : null };
  });
}

interface CsvRow {
  symbol?: string;
  type?: string;
  qty?: string;
  price?: string;
  fee?: string;
  fee_pct?: string;
  platform?: string;
  date?: string;
  currency?: string;
  fx_rate?: string;
  asset_class?: string;
  note?: string;
}

const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

/** Generic CSV. Rows are applied oldest first; each row succeeds or is reported alone. */
export async function importTrades(tx: Tx, csv: string, defaultPlatform?: string) {
  let records: CsvRow[];
  try {
    records = parse(csv, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new LadderError(`Could not read the CSV: ${err instanceof Error ? err.message : err}`);
  }
  const rows = records
    .map((record, index) => ({ record, line: index + 2 }))
    .sort(
      (a, b) =>
        (a.record.date ?? "").localeCompare(b.record.date ?? "") ||
        Number(a.record.type === "sell") - Number(b.record.type === "sell") ||
        a.line - b.line,
    );

  let added = 0;
  const skipped: Array<{ line: number; reason: string }> = [];
  for (const { record, line } of rows) {
    try {
      const symbol = blank(record.symbol);
      const type = blank(record.type)?.toLowerCase() as TradeType | undefined;
      if (!symbol || !type) throw new LadderError("symbol and type are required");
      const input: LogTrade = {
        symbol,
        type,
        qty: blank(record.qty),
        price: blank(record.price),
        fee: blank(record.fee),
        fee_pct: blank(record.fee_pct),
        platform: blank(record.platform) ?? defaultPlatform,
        date: blank(record.date),
        trade_currency: blank(record.currency)?.toUpperCase() as "IDR" | "USD" | undefined,
        fx_rate: blank(record.fx_rate),
        asset_class: blank(record.asset_class) as LogTrade["asset_class"],
        note: blank(record.note),
      };
      await tx(async (db) => {
        if (await isDuplicate(db, input)) throw new LadderError("already imported (same asset, type, qty, price, date, platform)");
        const saved = await saveTrade(db, input);
        const holding = await holdingFor(db, saved.asset.id);
        await applyLifecycle(db, saved.asset.id, saved.asset.symbol, type, saved.date, holding?.idr.qty ?? new Decimal(0));
      });
      added += 1;
    } catch (err) {
      skipped.push({ line, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  skipped.sort((a, b) => a.line - b.line);
  return { rows_added: added, rows_skipped: skipped.length, skipped };
}

async function isDuplicate(db: Db, input: LogTrade): Promise<boolean> {
  const { date, amount, price } = normalizeTrade(input);
  const asset = await findAsset(db, input.symbol);
  if (!asset) return false;
  const { rows } = await db.query(
    `select 1 from trades where asset_id = $1 and type = $2 and qty = $3 and price = $4
       and traded_at = $5 and platform is not distinct from $6::text limit 1`,
    [asset.id, input.type, amount.toString(), price.toString(), date, input.platform ?? null],
  );
  return rows.length > 0;
}

export async function tradesFor(db: Db, symbol: string, limit = 50) {
  const asset = await requireAsset(db, symbol);
  const { rows } = await db.query(
    `select id, type, qty, price, fee, currency, fx_to_idr, platform, traded_at as date, note
     from trades where asset_id = $1 order by traded_at desc, id desc limit $2`,
    [asset.id, limit],
  );
  return rows;
}

export const TRADE_SIDES = ["all", "buy", "sell", "dividend", "other"] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

const sideOf = (type: string): TradeSide =>
  type === "buy" || type === "sell" || type === "dividend" ? type : "other";

/** What the trade did to your money: fees add to a purchase and come off proceeds. */
function netAmount(type: string, gross: Decimal, fee: Decimal): Decimal {
  if (type === "fee") return fee;
  return type === "buy" || type === "deposit" ? gross.plus(fee) : gross.minus(fee);
}

/** Every trade across all assets, newest first, with totals for whatever the filters leave. */
export async function getTradeLog(db: Db, filter: { side?: string; symbol?: string } = {}) {
  const { rows } = await db.query<{
    id: number;
    symbol: string;
    class: string;
    type: string;
    qty: string;
    price: string;
    fee: string;
    currency: string;
    fx_to_idr: string;
    date: string;
  }>(
    `select t.id, a.symbol, a.class, t.type, t.qty, t.price, t.fee, t.currency, t.fx_to_idr, t.traded_at as date
     from trades t join assets a on a.id = t.asset_id
     order by t.traded_at desc, t.id desc`,
  );

  const side = TRADE_SIDES.find((s) => s === filter.side) ?? "all";
  const symbol = filter.symbol || null;
  const totals = { buy: new Decimal(0), sell: new Decimal(0), dividend: new Decimal(0) };

  const entries = rows
    .filter((r) => (side === "all" || sideOf(r.type) === side) && (!symbol || r.symbol === symbol))
    .map((r) => {
      const net = netAmount(r.type, new Decimal(r.qty).times(r.price), new Decimal(r.fee));
      const netIdr = net.times(r.fx_to_idr);
      const key = sideOf(r.type);
      if (key !== "all" && key !== "other") totals[key] = totals[key].plus(netIdr);
      return {
        id: r.id,
        symbol: r.symbol,
        class: r.class,
        type: r.type,
        qty: r.qty,
        price: r.price,
        currency: r.currency,
        date: r.date,
        net: net.toString(),
        net_idr: netIdr.toString(),
      };
    });

  return {
    side,
    symbol,
    has_trades: rows.length > 0,
    symbols: [...new Set(rows.map((r) => r.symbol))].sort(),
    entries,
    totals: { bought_idr: totals.buy.toString(), sold_idr: totals.sell.toString(), dividends_idr: totals.dividend.toString() },
  };
}
