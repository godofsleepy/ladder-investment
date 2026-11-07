"use server";
import type { AssetClass } from "@ladder/assets";
import { withUser, type Db } from "@ladder/db";
import { addNote } from "@ladder/journal";
import { LadderError } from "@ladder/money";
import { ignoreAlert, previewTrade, restoreAlert } from "@ladder/overview";
import { fillAssetHistory } from "@ladder/prices/history";
import { refreshPrices } from "@ladder/prices/refresh";
import { linkMacroAsset, unlinkMacroAsset } from "@ladder/macro";
import { editThesis, reviewThesis, saveThesis, type ReviewEvery } from "@ladder/thesis";
import { logTrade, settleTrade } from "@ladder/trades";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";

export type Result = { ok: true; message: string } | { ok: false; error: string };

const CADENCES: ReviewEvery[] = ["monthly", "quarterly", "half-yearly"];

/** Every action runs as the signed-in account. An error the person can act on comes back as text. */
async function act(fn: (userId: number) => Promise<string>): Promise<Result> {
  const user = await requireUser();
  try {
    const message = await fn(user.id);
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof LadderError) return { ok: false, error: err.message };
    throw err;
  }
}

const txFor = (userId: number) => <T,>(fn: (db: Db) => Promise<T>) => withUser(userId, fn);

export async function logTradeAction(input: {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  date: string;
  assetClass?: AssetClass;
}): Promise<Result> {
  return act(async (userId) => {
    const tx = txFor(userId);
    const res = await logTrade(tx, {
      symbol: input.symbol,
      type: input.side === "sell" ? "sell" : "buy",
      qty: input.qty,
      price: input.price,
      fee: input.fee,
      date: input.date,
      asset_class: input.assetClass,
    });
    await settleTrade(tx, res.trade.symbol);
    return `${input.side === "sell" ? "Sold" : "Bought"} ${res.trade.qty} ${res.trade.symbol}`;
  });
}

export async function previewAction(input: { symbol: string; side: "buy" | "sell"; qty: number; price: number; fee: number }) {
  const user = await requireUser();
  try {
    const preview = await withUser(user.id, (db) => previewTrade(db, input), { readOnly: true });
    return { preview, error: null };
  } catch (err) {
    if (err instanceof LadderError) return { preview: null, error: err.message };
    throw err;
  }
}

export async function addNoteAction(input: { text: string; symbol: string }): Promise<Result> {
  return act(async (userId) => {
    if (!input.text.trim()) throw new LadderError("A note needs some text.");
    await withUser(userId, (db) => addNote(db, { body: input.text.trim(), symbol: input.symbol || undefined }));
    return "Note added";
  });
}

export async function saveThesisAction(input: {
  symbol: string;
  thesisId: number | null;
  statement: string;
  invalidate: string;
  alertBelow: number | null;
  every: ReviewEvery;
}): Promise<Result> {
  return act(async (userId) => {
    const title = input.statement.trim();
    if (!title) throw new LadderError("Write why you own it.");
    if (!CADENCES.includes(input.every)) throw new LadderError("Pick how often to review it.");
    const killCriteria = input.invalidate.trim() || "Not set";
    await withUser(userId, async (db) => {
      if (input.thesisId) {
        await editThesis(db, {
          thesis_id: input.thesisId,
          title,
          kill_criteria: killCriteria,
          kill_price: input.alertBelow,
          review_every: input.every,
        });
      } else {
        await saveThesis(db, {
          symbol: input.symbol,
          title,
          why: "",
          kill_criteria: killCriteria,
          kill_price: input.alertBelow ?? undefined,
          review_every: input.every,
          horizon: "1y",
          conviction: 3,
        });
      }
    });
    return `Thesis saved for ${input.symbol}`;
  });
}

export async function markReviewedAction(thesisId: number, symbol: string): Promise<Result> {
  return act(async (userId) => {
    const res = await withUser(userId, (db) => reviewThesis(db, { thesis_id: thesisId, still_valid: true, note: "Reviewed in Ladder." }));
    return `${symbol} thesis reviewed · next ${res.next_review}`;
  });
}

export async function refreshAction(): Promise<Result> {
  return act(async (userId) => {
    const res = await withUser(userId, (db) => refreshPrices(db));
    const count = res.updated.filter((u) => u.symbol !== "USDIDR").length;
    if (res.failed.length > 0) return `Refreshed ${count}. Couldn't fetch ${res.failed.map((f) => f.symbol).join(", ")}`;
    return `Prices refreshed · ${count} ${count === 1 ? "asset" : "assets"}`;
  });
}

export async function ignoreAlertAction(symbol: string): Promise<Result> {
  return act(async (userId) => {
    await withUser(userId, (db) => ignoreAlert(db, symbol));
    return `${symbol} alert ignored`;
  });
}

export async function restoreAlertAction(symbol: string): Promise<Result> {
  return act(async (userId) => {
    await withUser(userId, (db) => restoreAlert(db, symbol));
    return `${symbol} alert restored`;
  });
}

export async function loadPriceHistoryAction(symbol: string): Promise<Result> {
  return act(async (userId) => {
    await withUser(userId, (db) => fillAssetHistory(db, symbol));
    return "Price history loaded";
  });
}

export async function linkMacroAssetAction(viewId: number, symbol: string): Promise<Result> {
  return act(async (userId) => {
    await withUser(userId, (db) => linkMacroAsset(db, viewId, symbol));
    return `${symbol} linked`;
  });
}

export async function unlinkMacroAssetAction(viewId: number, symbol: string): Promise<Result> {
  return act(async (userId) => {
    await withUser(userId, (db) => unlinkMacroAsset(db, viewId, symbol));
    return `${symbol} unlinked`;
  });
}
