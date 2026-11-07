import { findAsset } from "./assets.js";
import { addMonths, assertDate, today } from "./dates.js";
import type { Db } from "./db.js";
import { Decimal, idr, LadderError, pct } from "./money.js";
import { loadHoldings } from "./portfolio.js";

export type SignalKind = "for" | "against" | "watch";
export interface Signal {
  kind: SignalKind;
  text: string;
}

export interface SaveMacroView {
  id?: number;
  short_name: string;
  area: string;
  conviction: "High" | "Medium" | "Low";
  status?: "holding" | "weak" | "broken";
  view: string;
  why?: string;
  wrong_if: string;
  signals?: Signal[];
  symbols?: string[];
  next_review?: string;
}

interface ViewRow {
  id: number;
  short_name: string;
  area: string;
  conviction: "High" | "Medium" | "Low";
  status: "holding" | "weak" | "broken";
  view: string;
  why: string;
  wrong_if: string;
  signals: Signal[];
  next_review: string;
}

export async function saveMacroView(db: Db, input: SaveMacroView) {
  const nextReview = input.next_review ? assertDate(input.next_review, "next_review") : addMonths(today(), 3);
  const assetIds: number[] = [];
  for (const symbol of input.symbols ?? []) {
    const asset = await findAsset(db, symbol);
    if (!asset) throw new LadderError(`No asset called ${symbol} yet. A macro view can only link holdings Ladder knows.`);
    assetIds.push(asset.id);
  }
  const values = [
    input.short_name,
    input.area,
    input.conviction,
    input.status ?? "holding",
    input.view,
    input.why ?? "",
    input.wrong_if,
    JSON.stringify(input.signals ?? []),
    nextReview,
  ];
  const saved = input.id
    ? await db.query<{ id: number }>(
        `update macro_views set short_name=$1, area=$2, conviction=$3, status=$4, view=$5, why=$6, wrong_if=$7,
           signals=$8, next_review=$9 where id=$10 returning id`,
        [...values, input.id],
      )
    : await db.query<{ id: number }>(
        `insert into macro_views (short_name, area, conviction, status, view, why, wrong_if, signals, next_review)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        values,
      );
  const id = saved.rows[0]?.id;
  if (!id) throw new LadderError(`No macro view ${input.id}`);
  if (input.symbols) {
    await db.query("delete from macro_holdings where view_id = $1", [id]);
    for (const assetId of new Set(assetIds)) {
      await db.query("insert into macro_holdings (view_id, asset_id) values ($1,$2)", [id, assetId]);
    }
  }
  return (await getMacroViews(db)).find((v) => v.id === id);
}

async function requireView(db: Db, id: number): Promise<void> {
  const { rowCount } = await db.query("select 1 from macro_views where id = $1", [id]);
  if (!rowCount) throw new LadderError(`No macro view ${id}`);
}

/** Adds one asset to a view, held or not, keeping the others. */
export async function linkMacroAsset(db: Db, viewId: number, symbol: string): Promise<void> {
  await requireView(db, viewId);
  const asset = await findAsset(db, symbol);
  if (!asset || asset.class === "fx") throw new LadderError(`No asset called ${symbol} yet. A macro view can only link assets Ladder knows.`);
  await db.query("insert into macro_holdings (view_id, asset_id) values ($1,$2) on conflict do nothing", [viewId, asset.id]);
}

export async function unlinkMacroAsset(db: Db, viewId: number, symbol: string): Promise<void> {
  await requireView(db, viewId);
  await db.query("delete from macro_holdings where view_id = $1 and asset_id in (select id from assets where symbol = $2)", [viewId, symbol]);
}

export async function deleteMacroView(db: Db, id: number) {
  const { rowCount } = await db.query("delete from macro_views where id = $1", [id]);
  if (!rowCount) throw new LadderError(`No macro view ${id}`);
  return { deleted: id };
}

/** Weakening and broken views first, then overdue ones, then the rest. */
export async function getMacroViews(db: Db) {
  const { rows } = await db.query<ViewRow>(
    "select id, short_name, area, conviction, status, view, why, wrong_if, signals, next_review from macro_views order by id",
  );
  const links = await db.query<{ view_id: number; asset_id: number }>("select view_id, asset_id from macro_holdings");
  const holdings = (await loadHoldings(db)).filter((h) => h.idr.qty.greaterThan(0));
  const total = holdings.reduce((sum, h) => sum.plus(h.valueIdr ?? 0), new Decimal(0));
  const date = today();

  const views = rows.map((view) => {
    const ids = new Set(links.rows.filter((l) => l.view_id === view.id).map((l) => l.asset_id));
    const riding = holdings.filter((h) => ids.has(h.assetId));
    const exposure = riding.reduce((sum, h) => sum.plus(h.valueIdr ?? 0), new Decimal(0));
    const overdue = view.next_review < date;
    return {
      ...view,
      state: view.status !== "holding" ? view.status : overdue ? ("review" as const) : ("holding" as const),
      overdue,
      symbols: riding.map((h) => h.symbol),
      exposure_idr: idr(exposure),
      exposure_pct: total.isZero() ? "0.00" : pct(exposure.div(total).times(100)),
    };
  });
  const rank = { weak: 0, broken: 0, review: 1, holding: 2 } as const;
  return views.sort((a, b) => rank[a.state] - rank[b.state] || a.id - b.id);
}
