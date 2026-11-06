import { requireAsset } from "./assets.js";
import type { Db } from "./db.js";
import { recentNotes } from "./journal.js";
import { formatPosition, holdingFor } from "./portfolio.js";
import { getTheses, thesisHistory } from "./thesis.js";
import { tradesFor } from "./trades.js";
import { getWatchlist } from "./watchlist.js";

export async function getAssetDetail(db: Db, symbol: string) {
  const asset = await requireAsset(db, symbol);
  const holding = await holdingFor(db, asset.id);
  const theses = await getTheses(db, { symbol: asset.symbol });
  const current = theses.find((t) => t.status === "active") ?? theses.find((t) => t.status === "draft");
  const watch = await getWatchlist(db, {});
  return {
    asset,
    position: holding ? formatPosition(holding) : null,
    thesis: current ?? null,
    thesis_reviews: current ? await thesisHistory(db, current.id) : [],
    closed_theses: theses.filter((t) => t !== current && t.status !== "draft"),
    watchlist_item: watch.items.find((i) => i.symbol === asset.symbol) ?? null,
    trades: await tradesFor(db, asset.symbol),
    recent_notes: await recentNotes(db, asset.id),
  };
}
