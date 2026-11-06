import type { Db } from "./db.js";
import { getPositions } from "./overview.js";
import { loadHoldings } from "./portfolio.js";
import { getTheses } from "./thesis.js";
import { getWatchlist } from "./watchlist.js";

export async function checkAlerts(db: Db) {
  const theses = await getTheses(db, { status: "needs_review" });
  const watchlist = await getWatchlist(db, { status: "triggered" });
  const active = await db.query<{ asset_id: number }>("select asset_id from theses where status = 'active'");
  const covered = new Set(active.rows.map((r) => r.asset_id));
  const holdings = await loadHoldings(db);
  const open = holdings.filter((h) => h.idr.qty.greaterThan(0));
  const { positions } = await getPositions(db);

  return {
    overweight_positions: positions
      .filter((p) => p.reason === "cap")
      .map((p) => ({ symbol: p.symbol, weight_pct: p.weight_pct, cap_pct: p.cap_pct })),
    theses_needing_review: theses.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      title: t.title,
      why: t.why,
      triggers: t.review_triggers,
      return_since_opened_pct: t.return_since_opened_pct,
    })),
    watchlist_in_zone: watchlist.items
      .filter((i) => i.alert)
      .map((i) => ({
        id: i.id,
        symbol: i.symbol,
        price: i.price,
        zone_low: i.zone_low,
        zone_high: i.zone_high,
        reason: i.reason,
        priority: i.priority,
      })),
    positions_without_thesis: open.filter((h) => !covered.has(h.assetId)).map((h) => h.symbol),
    stale_prices: open.filter((h) => h.stale).map((h) => ({ symbol: h.symbol, price_date: h.priceDate })),
    unpriced_positions: open.filter((h) => !h.price).map((h) => h.symbol),
  };
}
