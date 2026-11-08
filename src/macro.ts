import { ensureAsset, type AssetClass } from "./assets.js";
import { addMonths, assertDate, today } from "./dates.js";
import type { Db } from "./db.js";
import { Decimal, idr, LadderError, pct } from "./money.js";
import { loadHoldings } from "./portfolio.js";

export type SignalKind = "for" | "against" | "watch";
export interface Signal {
  kind: SignalKind;
  text: string;
}

/** On an update, any field left out keeps its saved value. Adding a view needs the first five. */
export interface SaveMacroView {
  id?: number;
  short_name?: string;
  area?: string;
  conviction?: "High" | "Medium" | "Low";
  status?: "holding" | "weak" | "broken";
  view?: string;
  why?: string;
  wrong_if?: string;
  signals?: Signal[];
  /** Any ticker, held or not. One Ladder hasn't seen yet is added as an asset. */
  symbols?: string[];
  /** The class of a symbol Ladder can't infer, e.g. { NVDA: "us_stock" }. */
  asset_classes?: Record<string, AssetClass>;
  next_review?: string;
}

const classFor = (classes: Record<string, AssetClass> | undefined, symbol: string) =>
  classes?.[symbol] ?? classes?.[symbol.trim().toUpperCase()];

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

const REQUIRED = ["short_name", "area", "conviction", "view", "wrong_if"] as const;

export async function saveMacroView(db: Db, input: SaveMacroView) {
  let current: ViewRow | undefined;
  if (input.id) {
    const { rows } = await db.query<ViewRow>(
      "select id, short_name, area, conviction, status, view, why, wrong_if, signals, next_review from macro_views where id = $1",
      [input.id],
    );
    current = rows[0];
    if (!current) throw new LadderError(`No macro view ${input.id}`);
  } else {
    const missing = REQUIRED.filter((key) => !input[key]);
    if (missing.length > 0) throw new LadderError(`A new macro view needs ${missing.join(", ")}`);
  }
  const nextReview = input.next_review
    ? assertDate(input.next_review, "next_review")
    : (current?.next_review ?? addMonths(today(), 3));
  const assetIds: number[] = [];
  for (const symbol of input.symbols ?? []) {
    const asset = await ensureAsset(db, symbol, { asset_class: classFor(input.asset_classes, symbol) });
    assetIds.push(asset.id);
  }
  const values = [
    input.short_name ?? current?.short_name,
    input.area ?? current?.area,
    input.conviction ?? current?.conviction,
    input.status ?? current?.status ?? "holding",
    input.view ?? current?.view,
    input.why ?? current?.why ?? "",
    input.wrong_if ?? current?.wrong_if,
    JSON.stringify(input.signals ?? current?.signals ?? []),
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

/** Adds one ticker to a view, keeping the others. It needn't be held, or known to Ladder yet. */
export async function linkMacroAsset(db: Db, viewId: number, symbol: string, assetClass?: AssetClass): Promise<{ assetId: number; symbol: string }> {
  await requireView(db, viewId);
  if (!symbol.trim()) throw new LadderError("Type a ticker to link");
  const asset = await ensureAsset(db, symbol, { asset_class: assetClass });
  await db.query("insert into macro_holdings (view_id, asset_id) values ($1,$2) on conflict do nothing", [viewId, asset.id]);
  return { assetId: asset.id, symbol: asset.symbol };
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
