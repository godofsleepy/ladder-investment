import { requireAsset, ensureAsset, type NewAssetHints } from "./assets.js";
import { addMonths, assertDate, daysBetween, today } from "./dates.js";
import type { Db } from "./db.js";
import { Decimal, LadderError, parseAmount, pct } from "./money.js";
import { holdingFor, loadHoldings, type Holding } from "./portfolio.js";
import { latestPrices, type LatestPrice } from "./prices/store.js";

export type Horizon = "3m" | "6m" | "1y" | "3y" | "5y+";
export type ThesisStatus = "draft" | "active" | "achieved" | "invalidated" | "closed";
export type ReviewEvery = "monthly" | "quarterly" | "half-yearly";

export const CADENCE_MONTHS: Record<ReviewEvery, number> = { monthly: 1, quarterly: 3, "half-yearly": 6 };

interface ThesisRow {
  id: number;
  asset_id: number;
  title: string;
  why: string;
  target_price: string | null;
  kill_criteria: string;
  kill_price: string | null;
  horizon: Horizon;
  conviction: number;
  status: ThesisStatus;
  opened_at: string | null;
  closed_at: string | null;
  outcome: "right" | "wrong" | "mixed" | null;
  next_review_at: string;
  add_rule: string | null;
  trim_rule: string | null;
  max_weight_pct: string | null;
  review_every: ReviewEvery;
  last_reviewed_on: string | null;
  symbol: string;
  currency: string;
  last_review_price: string | null;
}

const THESIS_SQL = `
  select t.id, t.asset_id, t.title, t.why, t.target_price, t.kill_criteria, t.kill_price, t.horizon,
         t.conviction, t.status, t.opened_at, t.closed_at, t.outcome, t.next_review_at,
         t.add_rule, t.trim_rule, t.max_weight_pct, t.review_every, t.last_reviewed_on,
         a.symbol, a.currency,
         (select r.price_at_review from thesis_reviews r where r.thesis_id = t.id
          order by r.reviewed_at desc, r.id desc limit 1) as last_review_price
  from theses t join assets a on a.id = t.asset_id`;

/**
 * Why an active thesis wants attention. A price trigger already answered in the
 * last review stays quiet until the next review date, so a "still valid" answer
 * is not asked again every day the price sits past the line.
 */
function reviewTriggers(t: ThesisRow, price: LatestPrice | undefined): string[] {
  if (t.status !== "active") return [];
  const date = today();
  const triggers: string[] = [];
  const reviewDue = t.next_review_at <= date;
  if (reviewDue) triggers.push(`Review date ${t.next_review_at} has passed`);
  if (!price) return triggers;

  const reviewed = t.last_review_price ? new Decimal(t.last_review_price) : null;
  if (t.kill_price) {
    const kill = new Decimal(t.kill_price);
    const answered = reviewed?.lessThanOrEqualTo(kill) && !reviewDue;
    if (price.close.lessThanOrEqualTo(kill) && !answered) {
      triggers.push(`Price ${price.close} hit kill price ${t.kill_price}`);
    }
  }
  if (t.target_price) {
    const target = new Decimal(t.target_price);
    const answered = reviewed?.greaterThanOrEqualTo(target) && !reviewDue;
    if (price.close.greaterThanOrEqualTo(target) && !answered) {
      triggers.push(`Price ${price.close} hit target ${t.target_price}`);
    }
  }
  return triggers;
}

function distancePct(price: Decimal | undefined, level: string | null): string | null {
  if (!price || !level) return null;
  return pct(new Decimal(level).minus(price).div(price).times(100));
}

function describe(t: ThesisRow, price: LatestPrice | undefined, holding: Holding | undefined) {
  const triggers = reviewTriggers(t, price);
  return {
    id: t.id,
    symbol: t.symbol,
    title: t.title,
    why: t.why,
    kill_criteria: t.kill_criteria,
    kill_price: t.kill_price,
    target_price: t.target_price,
    horizon: t.horizon,
    conviction: t.conviction,
    status: t.status,
    outcome: t.outcome,
    opened_at: t.opened_at,
    closed_at: t.closed_at,
    next_review: t.next_review_at,
    add_rule: t.add_rule,
    trim_rule: t.trim_rule,
    max_weight_pct: t.max_weight_pct,
    review_every: t.review_every,
    last_reviewed: t.last_reviewed_on,
    days_to_review: t.status === "active" ? daysBetween(today(), t.next_review_at) : null,
    current_price: price?.close.toString() ?? null,
    currency: t.currency,
    return_since_opened_pct:
      t.status === "active" && holding?.unrealizedPct ? pct(holding.unrealizedPct) : null,
    distance_to_target_pct: distancePct(price?.close, t.target_price),
    distance_to_kill_pct: distancePct(price?.close, t.kill_price),
    needs_review: triggers.length > 0,
    review_triggers: triggers,
  };
}

export async function getTheses(
  db: Db,
  filters: { status?: ThesisStatus | "needs_review"; symbol?: string } = {},
) {
  const assetId = filters.symbol ? (await requireAsset(db, filters.symbol)).id : null;
  const { rows } = await db.query<ThesisRow>(
    `${THESIS_SQL} where ($1::int is null or t.asset_id = $1) order by t.next_review_at, t.id`,
    [assetId],
  );
  const prices = await latestPrices(db);
  const holdings = new Map((await loadHoldings(db)).map((h) => [h.assetId, h]));
  const all = rows.map((t) => describe(t, prices.get(t.asset_id), holdings.get(t.asset_id)));
  if (filters.status === "needs_review") return all.filter((t) => t.needs_review);
  return filters.status ? all.filter((t) => t.status === filters.status) : all;
}

export async function getThesis(db: Db, id: number) {
  const found = await rawThesis(db, id);
  const prices = await latestPrices(db);
  return describe(found, prices.get(found.asset_id), await holdingFor(db, found.asset_id));
}

async function rawThesis(db: Db, id: number): Promise<ThesisRow> {
  const { rows } = await db.query<ThesisRow>(`${THESIS_SQL} where t.id = $1`, [id]);
  if (!rows[0]) throw new LadderError(`No thesis ${id}`);
  return rows[0];
}

const optional = (v: string | number | undefined, label: string) =>
  v === undefined ? null : parseAmount(v, label).toString();

export interface SaveThesis extends NewAssetHints {
  symbol: string;
  title: string;
  why: string;
  kill_criteria: string;
  horizon: Horizon;
  conviction: number;
  target_price?: string | number;
  kill_price?: string | number;
  next_review?: string;
  add_rule?: string;
  trim_rule?: string;
  max_weight_pct?: string | number;
  review_every?: ReviewEvery;
}

/** Writes the asset's thesis: active if it is owned, otherwise a draft. An existing draft is overwritten. */
export async function saveThesis(db: Db, input: SaveThesis) {
  if (input.title.length > 200) throw new LadderError("title must be 200 characters or fewer");
  const date = today();
  const every = input.review_every ?? "quarterly";
  const nextReview = input.next_review ? assertDate(input.next_review, "next_review") : addMonths(date, CADENCE_MONTHS[every]);
  if (nextReview <= date) throw new LadderError("next_review must be after today");

  const asset = await ensureAsset(db, input.symbol, input);
  const active = await db.query<{ id: number }>(
    "select id from theses where asset_id = $1 and status = 'active'",
    [asset.id],
  );
  if (active.rows[0]) {
    throw new LadderError(
      `${asset.symbol} already has active thesis ${active.rows[0].id}. Use review_thesis with changes to update it, so the old version is kept.`,
    );
  }

  const owned = (await holdingFor(db, asset.id))?.idr.qty.greaterThan(0) ?? false;
  const status = owned ? "active" : "draft";
  const values = [
    input.title,
    input.why,
    optional(input.target_price, "target_price"),
    input.kill_criteria,
    optional(input.kill_price, "kill_price"),
    input.horizon,
    input.conviction,
    status,
    owned ? date : null,
    nextReview,
    input.add_rule ?? null,
    input.trim_rule ?? null,
    optional(input.max_weight_pct, "max_weight_pct"),
    every,
  ];

  const draft = await db.query<{ id: number }>(
    "select id from theses where asset_id = $1 and status = 'draft'",
    [asset.id],
  );
  const saved = draft.rows[0]
    ? await db.query<{ id: number }>(
        `update theses set title=$1, why=$2, target_price=$3, kill_criteria=$4, kill_price=$5, horizon=$6,
           conviction=$7, status=$8, opened_at=$9, next_review_at=$10, add_rule=$11, trim_rule=$12,
           max_weight_pct=$13, review_every=$14 where id=$15 returning id`,
        [...values, draft.rows[0].id],
      )
    : await db.query<{ id: number }>(
        `insert into theses (title, why, target_price, kill_criteria, kill_price, horizon, conviction,
           status, opened_at, next_review_at, add_rule, trim_rule, max_weight_pct, review_every, asset_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [...values, asset.id],
      );
  const id = (saved.rows[0] as { id: number }).id;

  await db.query(
    "update watchlist set thesis_id = $2 where asset_id = $1 and status in ('watching','triggered')",
    [asset.id, id],
  );
  return getThesis(db, id);
}

/** The PRD keeps review answers in the journal as well as in the review history. */
async function journalReview(db: Db, t: ThesisRow, note: string | undefined): Promise<void> {
  if (!note?.trim()) return;
  await db.query("insert into journal (asset_id, thesis_id, body, tags) values ($1,$2,$3,$4)", [
    t.asset_id,
    t.id,
    note,
    ["review"],
  ]);
}

export interface ThesisChanges {
  title?: string;
  why?: string;
  kill_criteria?: string;
  horizon?: Horizon;
  conviction?: number;
  target_price?: string | number;
  kill_price?: string | number;
  add_rule?: string;
  trim_rule?: string;
  max_weight_pct?: string | number;
  review_every?: ReviewEvery;
}

export interface ReviewThesis {
  thesis_id: number;
  still_valid: boolean;
  note?: string;
  next_review?: string;
  changes?: ThesisChanges;
}

export async function reviewThesis(db: Db, input: ReviewThesis) {
  const t = await rawThesis(db, input.thesis_id);
  if (t.status !== "active") throw new LadderError(`Thesis ${t.id} is ${t.status}; only active theses are reviewed`);
  const date = today();
  const every = input.changes?.review_every ?? t.review_every;
  const nextReview = input.next_review ? assertDate(input.next_review, "next_review") : addMonths(date, CADENCE_MONTHS[every]);
  if (nextReview <= date) throw new LadderError("next_review must be after today");
  if (input.changes?.title && input.changes.title.length > 200) {
    throw new LadderError("title must be 200 characters or fewer");
  }

  const price = (await latestPrices(db)).get(t.asset_id);
  const hasChanges = input.changes !== undefined && Object.keys(input.changes).length > 0;
  const { last_review_price: _ignored, symbol: _symbol, currency: _currency, ...snapshot } = t;
  await db.query(
    `insert into thesis_reviews (thesis_id, action, still_valid, note, price_at_review, snapshot)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      t.id,
      hasChanges ? "update" : "still_valid",
      input.still_valid,
      input.note ?? null,
      price?.close.toString() ?? null,
      hasChanges ? JSON.stringify(snapshot) : null,
    ],
  );

  await journalReview(db, t, input.note);

  const c = input.changes ?? {};
  await db.query(
    `update theses set title = coalesce($2,title), why = coalesce($3,why), kill_criteria = coalesce($4,kill_criteria),
       horizon = coalesce($5,horizon), conviction = coalesce($6,conviction),
       target_price = coalesce($7,target_price), kill_price = coalesce($8,kill_price), next_review_at = $9,
       review_notified_on = null, add_rule = coalesce($10,add_rule), trim_rule = coalesce($11,trim_rule),
       max_weight_pct = coalesce($12,max_weight_pct), review_every = $13, last_reviewed_on = $14
     where id = $1`,
    [
      t.id,
      c.title ?? null,
      c.why ?? null,
      c.kill_criteria ?? null,
      c.horizon ?? null,
      c.conviction ?? null,
      optional(c.target_price, "target_price"),
      optional(c.kill_price, "kill_price"),
      nextReview,
      c.add_rule ?? null,
      c.trim_rule ?? null,
      optional(c.max_weight_pct, "max_weight_pct"),
      every,
      date,
    ],
  );
  const thesis = await getThesis(db, t.id);
  return {
    review_saved: true,
    next_review: nextReview,
    thesis,
    ...(input.still_valid ? {} : { prompt: "Marked not valid. If the call is over, use close_thesis." }),
  };
}

/** The Thesis form on an asset: changes the statement, invalidation and cadence, keeping the old version. */
export async function editThesis(
  db: Db,
  input: { thesis_id: number; title: string; kill_criteria: string; kill_price: string | number | null; review_every: ReviewEvery },
) {
  const t = await rawThesis(db, input.thesis_id);
  const date = today();
  const { last_review_price: _ignored, symbol: _symbol, currency: _currency, ...snapshot } = t;
  const price = (await latestPrices(db)).get(t.asset_id);
  await db.query(
    `insert into thesis_reviews (thesis_id, action, still_valid, note, price_at_review, snapshot)
     values ($1,'update',true,$2,$3,$4)`,
    [t.id, "Edited in Ladder.", price?.close.toString() ?? null, JSON.stringify(snapshot)],
  );
  await db.query(
    `update theses set title=$2, kill_criteria=$3, kill_price=$4, review_every=$5, next_review_at=$6,
       last_reviewed_on=$7, review_notified_on=null where id=$1`,
    [
      t.id,
      input.title,
      input.kill_criteria,
      input.kill_price === null ? null : parseAmount(input.kill_price, "kill_price").toString(),
      input.review_every,
      addMonths(date, CADENCE_MONTHS[input.review_every]),
      date,
    ],
  );
  return getThesis(db, t.id);
}

export async function closeThesis(
  db: Db,
  input: {
    thesis_id: number;
    status: "achieved" | "invalidated" | "closed";
    outcome: "right" | "wrong" | "mixed";
    note?: string;
  },
) {
  const t = await rawThesis(db, input.thesis_id);
  if (t.status !== "active") throw new LadderError(`Thesis ${t.id} is ${t.status}; only active theses can be closed`);
  const holding = await holdingFor(db, t.asset_id);
  const price = (await latestPrices(db)).get(t.asset_id);
  await db.query(
    `insert into thesis_reviews (thesis_id, action, still_valid, note, price_at_review) values ($1,'close',false,$2,$3)`,
    [t.id, input.note ?? null, price?.close.toString() ?? null],
  );
  await journalReview(db, t, input.note);
  const date = today();
  await db.query("update theses set status=$2, outcome=$3, closed_at=$4 where id=$1", [
    t.id,
    input.status,
    input.outcome,
    date,
  ]);
  return {
    id: t.id,
    symbol: t.symbol,
    title: t.title,
    status: input.status,
    outcome: input.outcome,
    days_held: t.opened_at ? daysBetween(t.opened_at, date) : null,
    still_held_qty: holding?.idr.qty.toString() ?? "0",
    realized_idr: holding ? holding.idr.realized.toDecimalPlaces(2).toFixed(2) : "0.00",
  };
}

export async function thesisHistory(db: Db, thesisId: number) {
  const { rows } = await db.query(
    `select reviewed_at, action, still_valid, note, price_at_review, snapshot
     from thesis_reviews where thesis_id = $1 order by reviewed_at desc, id desc`,
    [thesisId],
  );
  return rows;
}

interface ScoreRow {
  outcome: "right" | "wrong" | "mixed";
  class: string;
  conviction: number;
}

function tally(rows: ScoreRow[]) {
  const count = (o: ScoreRow["outcome"]) => rows.filter((r) => r.outcome === o).length;
  const right = count("right");
  const wrong = count("wrong");
  const decided = right + wrong;
  return {
    total: rows.length,
    right,
    wrong,
    mixed: count("mixed"),
    /** Right as a share of right plus wrong. Mixed calls are reported but not scored. */
    hit_rate_pct: decided === 0 ? null : pct(new Decimal(right).div(decided).times(100)),
  };
}

function groupBy<K>(rows: ScoreRow[], key: (r: ScoreRow) => K): Array<[K, ScoreRow[]]> {
  const groups = new Map<K, ScoreRow[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return [...groups];
}

export async function getScorecard(db: Db) {
  const { rows } = await db.query<ScoreRow>(
    `select t.outcome, a.class, t.conviction from theses t join assets a on a.id = t.asset_id
     where t.status in ('achieved','invalidated','closed') and t.outcome is not null`,
  );
  return {
    overall: tally(rows),
    by_class: groupBy(rows, (r) => r.class)
      .map(([group, list]) => ({ class: group, ...tally(list) }))
      .sort((a, b) => a.class.localeCompare(b.class)),
    by_conviction: groupBy(rows, (r) => r.conviction)
      .map(([conviction, list]) => ({ conviction, ...tally(list) }))
      .sort((a, b) => b.conviction - a.conviction),
  };
}
