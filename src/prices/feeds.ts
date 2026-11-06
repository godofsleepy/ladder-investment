import { Decimal, LadderError } from "../money.js";

const TIMEOUT_MS = 15_000;
const TROY_OUNCE_GRAMS = new Decimal("31.1034768");

/** Yahoo has no spot XAU symbol, so front-month gold futures stand in for it. */
export const GOLD_YAHOO_SYMBOL = "GC=F";

interface YahooChart {
  chart: {
    result?: Array<{
      meta: { currency?: string; regularMarketPrice?: number; gmtoffset?: number; longName?: string; shortName?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { description?: string } | null;
  };
}

async function getJson<T>(url: string, source: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)", Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${source} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

function chartUrl(symbol: string, query: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
}

export async function yahooQuote(symbol: string): Promise<{ price: Decimal; currency: string; name: string | null }> {
  const data = await getJson<YahooChart>(chartUrl(symbol, "range=5d&interval=1d"), "Yahoo");
  const meta = data.chart.result?.[0]?.meta;
  if (!meta?.regularMarketPrice || !meta.currency) {
    throw new Error(data.chart.error?.description ?? `Yahoo has no price for ${symbol}`);
  }
  return { price: new Decimal(meta.regularMarketPrice), currency: meta.currency, name: meta.longName ?? meta.shortName ?? null };
}

/** Last close on or before `date`, looking back up to 7 days for weekends and holidays. */
export async function yahooCloseOn(symbol: string, date: string): Promise<Decimal> {
  const end = Date.parse(`${date}T23:59:59Z`) / 1000;
  const start = end - 7 * 86_400;
  const data = await getJson<YahooChart>(
    chartUrl(symbol, `period1=${Math.floor(start)}&period2=${Math.floor(end)}&interval=1d`),
    "Yahoo",
  );
  const closes = data.chart.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const last = closes.filter((c): c is number => typeof c === "number").at(-1);
  if (last === undefined) throw new Error(`Yahoo has no ${symbol} close near ${date}`);
  return new Decimal(last);
}

export interface DailyClose {
  date: string;
  close: Decimal;
}

/** Daily closes between two dates, dated in the exchange's own timezone. */
export async function yahooHistory(symbol: string, from: string, to: string): Promise<DailyClose[]> {
  const start = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const end = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  const data = await getJson<YahooChart>(chartUrl(symbol, `period1=${start}&period2=${end}&interval=1d`), "Yahoo");
  const result = data.chart.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const offset = result?.meta.gmtoffset ?? 0;
  const out: DailyClose[] = [];
  stamps.forEach((stamp, i) => {
    const close = closes[i];
    if (typeof close === "number") {
      out.push({ date: new Date((stamp + offset) * 1000).toISOString().slice(0, 10), close: new Decimal(close) });
    }
  });
  return out;
}

export async function coingeckoIdr(ids: string[]): Promise<Map<string, Decimal>> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=idr`;
  const data = await getJson<Record<string, { idr?: number }>>(url, "CoinGecko");
  const out = new Map<string, Decimal>();
  for (const id of ids) {
    const value = data[id]?.idr;
    if (value) out.set(id, new Decimal(value));
  }
  return out;
}

export function goldPerGramIdr(usdPerOunce: Decimal, usdIdr: Decimal): Decimal {
  return usdPerOunce.div(TROY_OUNCE_GRAMS).times(usdIdr);
}

export function feedError(err: unknown): string {
  if (err instanceof LadderError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
