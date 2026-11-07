/**
 * Plain-text summaries for the copy buttons. Each one names the record and its id and
 * carries the numbers Ladder already worked out, so an assistant can act without looking it up.
 */
import { capitalize, classLabel, convictionWord, fd, fullDate, MACRO_BADGE, moneyOf, nat, pc, pct1, POSITION_BADGE, positionWhy, qf, WATCH_BADGE, type Money, type WatchKind } from "./format";
import type { Position } from "./ladder";

type Line = [string, string | number | null | undefined | false];

function block(head: string, rows: Line[], tail?: string): string {
  const body = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "").map(([k, v]) => `${k}: ${v}`);
  return [head, ...body, ...(tail ? [tail] : [])].join("\n");
}

export function positionContext(p: Position, base: Money): string {
  const { money, signed } = moneyOf(base);
  const badge = POSITION_BADGE[p.state];
  const thesis = (p as Position & { thesis?: { id: number; title: string } | null }).thesis;
  return block(`Ladder holding · ${p.symbol}${p.name !== p.symbol ? ` (${p.name})` : ""} · ${classLabel(p.class)}`, [
    ["Quantity", `${qf(p.qty, p.symbol, p.class)}, avg ${p.avg_cost ? nat(p.price_currency, p.avg_cost) : nat("IDR", p.avg_cost_idr)}`],
    ["Price", p.price === null ? "none yet" : `${nat(p.price_currency, p.price)}${p.price_date ? ` (${fd(p.price_date)})` : ""}${p.price_stale ? ", stale" : ""}`],
    ["Value", p.price === null ? "unknown until Ladder has a price" : `${money(p.value_idr)}${p.weight_pct ? `, ${pc(p.weight_pct)} of portfolio` : ""}`],
    ["Unrealised P&L", p.price === null ? null : `${signed(p.unrealized_idr)} (${pct1(p.unrealized_pct)})`],
    ["Cost", money(p.cost_idr)],
    ["Thesis", thesis ? `#${thesis.id} ${thesis.title}` : "none"],
    ["Status", `${badge.label}: ${positionWhy(p)}`],
    ["Macro view", p.macro ? `${p.macro.short_name} (${MACRO_BADGE[p.macro.state].label})` : null],
  ]);
}

export interface WatchItem {
  id: number;
  symbol: string;
  name: string;
  currency: string;
  price: string | null;
  price_date?: string | null;
  zone_low: string;
  zone_high: string;
  reason: string;
  priority?: string | null;
  planned_amount_idr?: string | null;
  thesis_id: number | null;
  added_at: string;
}

export function watchContext(w: WatchItem, kind: WatchKind, distance: string): string {
  return block(`Ladder watchlist item #${w.id} · ${w.symbol}${w.name !== w.symbol ? ` (${w.name})` : ""}`, [
    ["Price", `${nat(w.currency, w.price)}${w.price_date ? ` (${fd(w.price_date)})` : ""}`],
    ["Buy zone", `${nat(w.currency, w.zone_low)} – ${nat(w.currency, w.zone_high)} (${distance}, ${WATCH_BADGE[kind].label})`],
    ["Priority", w.priority],
    ["Planned", w.planned_amount_idr ? nat("IDR", w.planned_amount_idr) : null],
    ["Reason", w.reason],
    ["Draft thesis", w.thesis_id ? `#${w.thesis_id}` : "none"],
    ["Added", fd(w.added_at)],
  ]);
}

export interface MacroView {
  id: number;
  short_name: string;
  area: string;
  conviction: string;
  view: string;
  why: string;
  wrong_if: string;
  signals: Array<{ kind: string; text: string }>;
  next_review: string;
  overdue: boolean;
  state: keyof typeof MACRO_BADGE;
  symbols: string[];
  exposure_idr: string;
  exposure_pct: string;
}

export function macroContext(v: MacroView, base: Money): string {
  const { money } = moneyOf(base);
  const word = { for: "For", against: "Against", watch: "Watching" } as Record<string, string>;
  return block(`Ladder macro view #${v.id} · ${v.short_name} · ${v.area}, ${v.conviction} conviction, ${MACRO_BADGE[v.state].label}`, [
    ["View", v.view],
    ["Why", v.why],
    ["Wrong if", v.wrong_if],
    ["Signals", v.signals.map((s) => `${word[s.kind] ?? s.kind}: ${s.text}`).join("; ")],
    ["Holdings riding on it", v.symbols.length ? `${v.symbols.join(", ")} (${money(v.exposure_idr)}, ${pc(v.exposure_pct)} of portfolio)` : "none held"],
    [v.overdue ? "Review was due" : "Next review", fd(v.next_review)],
  ]);
}

export interface ThesisLike {
  id: number;
  title: string;
  why: string;
  kill_criteria: string;
  kill_price: string | null;
  target_price: string | null;
  add_rule: string | null;
  trim_rule: string | null;
  max_weight_pct: string | null;
  conviction: number;
  horizon: string;
  status: string;
  review_every: string;
  next_review: string | null;
  last_reviewed: string | null;
}

export function thesisContext(t: ThesisLike, symbol: string, currency: string): string {
  return block(`Ladder thesis #${t.id} · ${symbol} · ${t.status}`, [
    ["Statement", t.title],
    ["Why", t.why],
    ["Invalidate if", t.kill_criteria],
    ["Kill price", t.kill_price ? nat(currency, t.kill_price) : null],
    ["Target price", t.target_price ? nat(currency, t.target_price) : null],
    ["Add", t.add_rule],
    ["Trim", t.trim_rule],
    ["Max weight", t.max_weight_pct ? pc(t.max_weight_pct) : null],
    ["Conviction", `${convictionWord(t.conviction)} (${t.conviction}/5), horizon ${t.horizon}`],
    ["Review", `${capitalize(t.review_every)}, last ${t.last_reviewed ? fd(t.last_reviewed) : "not yet"}, next ${fd(t.next_review)}`],
  ]);
}

export interface TradeLike {
  id: number;
  symbol: string;
  class: string;
  type: string;
  qty: string;
  price: string;
  currency: string;
  date: string;
  net?: string;
  net_idr?: string;
  fee?: string;
  platform?: string | null;
  note?: string | null;
}

export function tradeContext(t: TradeLike, base?: Money): string {
  const isFee = t.type === "fee";
  return block(`Ladder trade #${t.id} · ${capitalize(t.type)} ${t.symbol}`, [
    ["Date", fullDate(t.date)],
    ["Quantity", isFee ? null : `${qf(t.qty, t.symbol, t.class)} @ ${nat(t.currency, t.price)}`],
    ["Fee", t.fee && Number(t.fee) > 0 ? nat(t.currency, t.fee) : null],
    ["Net amount", t.net ? `${nat(t.currency, t.net)}${base && t.net_idr && t.currency !== base.currency ? ` (${moneyOf(base).money(t.net_idr)})` : ""}` : null],
    ["Platform", t.platform],
    ["Note", t.note],
  ]);
}

export function noteContext(n: { id: number; text: string; symbol: string | null; author: string; created_at: Date | string; tags?: string[] }): string {
  return block(`Ladder note #${n.id}${n.symbol ? ` · ${n.symbol}` : ""} · ${fd(n.created_at)} · ${n.author}`, [["Tags", n.tags?.join(", ")]], n.text);
}

/** Everything on the asset page in one block, for "help me decide on this". */
export function assetContext(parts: {
  symbol: string;
  name: string;
  cls: string;
  currency: string;
  price: string | null;
  feed: string;
  position: string | null;
  thesis: string | null;
  watch: string | null;
  trades: string[];
  tradeCount: number;
  notes: string[];
}): string {
  const head = `Ladder asset · ${parts.symbol}${parts.name !== parts.symbol ? ` (${parts.name})` : ""} · ${classLabel(parts.cls)} · ${nat(parts.currency, parts.price)} from ${parts.feed}`;
  const sections = [
    head,
    parts.position ?? "Not held.",
    parts.thesis ?? "No thesis.",
    ...(parts.watch ? [parts.watch] : []),
    parts.trades.length ? `Latest ${parts.trades.length} of ${parts.tradeCount} trades:\n${parts.trades.join("\n")}` : "No trades.",
    ...(parts.notes.length ? [`Recent notes:\n${parts.notes.join("\n")}`] : []),
  ];
  return sections.join("\n\n");
}
