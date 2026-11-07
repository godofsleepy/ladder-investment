import { listConnections } from "@ladder/auth";
import { withUser, getPool, type Db } from "@ladder/db";
import { getAssetDetail } from "@ladder/detail";
import { searchNotes } from "@ladder/journal";
import { getMacroViews } from "@ladder/macro";
import { LadderError } from "@ladder/money";
import { assetOptions, getGrowth, getPositions, getPriceStatus } from "@ladder/overview";
import { getAllocation } from "@ladder/portfolio";
import { getTradeLog } from "@ladder/trades";
import { getWatchlist } from "@ladder/watchlist";
import { notFound } from "next/navigation";
import type { Money } from "./format";
import { requireUser } from "./session";

/** Pages only ever read: as the signed-in account, in a transaction Postgres won't let write. */
async function read<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const user = await requireUser();
  return withUser(user.id, fn, { readOnly: true });
}

async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof LadderError) notFound();
    throw err;
  }
}

export const positions = () => read((db) => getPositions(db));
export const allocation = () => read((db) => getAllocation(db, "class"));
export const growth = () => read((db) => getGrowth(db));
export const macroViews = () => read((db) => getMacroViews(db));
export const watchlist = () => read((db) => getWatchlist(db, {}));
export const assets = () => read((db) => assetOptions(db));
export const priceStatus = () => read((db) => getPriceStatus(db));
export const notes = (text?: string) => orNotFound(() => read((db) => searchNotes(db, { text, limit: 100 })));
export const tradeLog = (filter: { side?: string; symbol?: string }) => read((db) => getTradeLog(db, filter));
export const assetDetail = (symbol: string) => orNotFound(() => read((db) => getAssetDetail(db, symbol)));

export async function connections() {
  const user = await requireUser();
  return listConnections(getPool(), user.id);
}

export async function moneySetting(): Promise<Money> {
  const user = await requireUser();
  if (user.base_currency === "IDR") return { currency: "IDR", rate: null };
  const { usd_idr: rate } = await priceStatus();
  return rate ? { currency: "USD", rate: Number(rate) } : { currency: "IDR", rate: null };
}

export type AssetOption = Awaited<ReturnType<typeof assets>>[number];
export type Position = Awaited<ReturnType<typeof positions>>["positions"][number];
export type Note = { kind: string; id: number; symbol: string | null; text: string; tags: string[]; author: string; created_at: Date };
export type Review = {
  reviewed_at: Date;
  action: "still_valid" | "update" | "close";
  still_valid: boolean;
  note: string | null;
};
export type Trade = {
  id: number;
  type: string;
  qty: string;
  price: string;
  fee: string;
  currency: string;
  platform: string | null;
  date: string;
  note: string | null;
};
