export const MINUS = "−";

export type Money = { currency: "IDR" | "USD"; rate: number | null };

/** The canvas's short rupiah: Rp412.3m, Rp1.20b. */
export function rp(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp${(a / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `Rp${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `Rp${(a / 1e3).toFixed(0)}k`;
  return `Rp${Math.round(a)}`;
}

const dollars = (n: number, dp: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

/** Totals in the account's base currency. Ladder computes in IDR; USD converts at today's rate for display. */
export function moneyOf({ currency, rate }: Money) {
  const money = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "No price";
    const idr = Number(value);
    return currency === "USD" && rate ? dollars(Math.abs(idr) / rate, 0) : rp(idr);
  };
  const signed = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "No price";
    return `${Number(value) < 0 ? MINUS : "+"}${money(Math.abs(Number(value)))}`;
  };
  return { money, signed };
}

/** A price in its own currency. */
export function nat(currency: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "No price";
  const n = Number(value);
  if (currency === "USD") return dollars(n, n >= 1000 ? 0 : 2);
  if (n > 0 && n < 1) return `Rp${n.toLocaleString("id-ID", { maximumFractionDigits: 8 })}`;
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

export function unitOf(symbol: string, cls: string): string {
  if (cls === "crypto") return symbol;
  if (cls === "gold") return "g";
  if (cls === "us_stock" || cls === "idx_stock") return "sh";
  return "units";
}

export function qf(qty: string | number, symbol: string, cls: string): string {
  const dp = cls === "crypto" ? [4, 8] : cls === "gold" ? [0, 2] : [0, 4];
  const text = Number(qty).toLocaleString("en-US", { minimumFractionDigits: dp[0], maximumFractionDigits: dp[1] });
  return `${text} ${unitOf(symbol, cls)}`;
}

/** Whole percent, from a percent value. */
export const pc = (value: string | number) => `${Math.round(Number(value))}%`;

/** Signed percent with one decimal, from a percent value. */
export function pct1(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "No price";
  const n = Number(value);
  return `${n < 0 ? MINUS : "+"}${Math.abs(n).toFixed(1)}%`;
}

const JAKARTA = "Asia/Jakarta";

export function fd(value: string | Date | null | undefined): string {
  if (!value) return "Not set";
  const d = typeof value === "string" ? new Date(`${value}T00:00:00+07:00`) : value;
  const sameYear = d.toLocaleDateString("en-US", { year: "numeric", timeZone: JAKARTA }) === new Date().toLocaleDateString("en-US", { year: "numeric", timeZone: JAKARTA });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: JAKARTA, ...(sameYear ? {} : { year: "numeric" }) });
}

export function monthYear(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: JAKARTA });
}

/** "08:00 WIB", or the date as well if it wasn't today. */
export function refreshedLabel(at: Date | string | null): string {
  if (!at) return "Not fetched yet";
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: JAKARTA });
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: JAKARTA });
  return day(d) === day(new Date()) ? `${time} WIB` : `${fd(d)}, ${time} WIB`;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).map((word) => word[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, " ");
}

export const CLASSES = [
  { key: "crypto", label: "Crypto", swatch: "var(--color-brand-dark)" },
  { key: "us_stock", label: "US stocks", swatch: "var(--color-brand)" },
  { key: "idx_stock", label: "IDX stocks", swatch: "color-mix(in srgb, var(--color-brand) 55%, transparent)" },
  { key: "gold", label: "Gold", swatch: "color-mix(in srgb, var(--color-brand) 30%, transparent)" },
  { key: "bond", label: "Bonds", swatch: "color-mix(in srgb, var(--color-faint) 55%, transparent)" },
  { key: "other", label: "Other", swatch: "var(--color-fill-strong)" },
] as const;

export const classLabel = (key: string) => CLASSES.find((c) => c.key === key)?.label ?? capitalize(key);

export function convictionWord(value: number): "High" | "Medium" | "Low" {
  return value >= 4 ? "High" : value === 3 ? "Medium" : "Low";
}

const BADGE = {
  good: "bg-good/12 text-good-strong",
  warn: "bg-warn/14 text-warn",
  bad: "bg-bad/12 text-bad-strong",
  plain: "bg-fill-strong text-ink-2",
  soft: "bg-fill text-ink-2",
} as const;

export const POSITION_BADGE = {
  alert: { label: "Alert", className: BADGE.bad, rank: 0 },
  missing: { label: "No thesis", className: BADGE.plain, rank: 1 },
  review: { label: "Review due", className: BADGE.warn, rank: 2 },
  ok: { label: "On track", className: BADGE.good, rank: 3 },
} as const;

export const MACRO_BADGE = {
  weak: { label: "Weakening", className: BADGE.warn, dot: "bg-warn" },
  broken: { label: "Broken", className: BADGE.bad, dot: "bg-bad" },
  review: { label: "Review due", className: BADGE.soft, dot: "bg-ink-2" },
  holding: { label: "Holding", className: BADGE.good, dot: "bg-good" },
} as const;

export const WATCH_BADGE = {
  zone: { label: "In zone", className: BADGE.good, dot: "bg-good", text: "text-good-strong" },
  near: { label: "Near", className: BADGE.warn, dot: "bg-warn", text: "text-warn" },
  wait: { label: "Waiting", className: BADGE.soft, dot: "bg-ink-2", text: "text-ink-2" },
} as const;

export type WatchKind = keyof typeof WATCH_BADGE;

/** The canvas treats a price below the zone as a buy, and within 5% above as near. */
export function watchKind(side: string | null, distancePct: string | null): WatchKind {
  if (side === "inside" || side === "below") return "zone";
  return side === "above" && Number(distancePct) <= 5 ? "near" : "wait";
}

export function positionWhy(p: {
  reason: string;
  price: string | null;
  price_currency: string;
  kill_price: string | null;
  target_price: string | null;
  weight_pct: string | null;
  cap_pct: number | null;
  next_review: string | null;
}): string {
  const c = p.price_currency;
  switch (p.reason) {
    case "none":
      return "Open position with no thesis";
    case "kill":
      return `Price ${nat(c, p.price)} is under the ${nat(c, p.kill_price)} invalidation level`;
    case "cap":
      return `Weight ${pc(p.weight_pct ?? 0)} is over its ${pc(p.cap_pct ?? 0)} cap`;
    case "target":
      return `Price ${nat(c, p.price)} reached the ${nat(c, p.target_price)} target`;
    case "date":
      return `Review was due ${fd(p.next_review)}`;
    default:
      return `Next review ${fd(p.next_review)}`;
  }
}
