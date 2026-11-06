import { requireAsset, type Asset } from "../assets.js";
import { today } from "../dates.js";
import type { Db } from "../db.js";
import { Decimal, LadderError, parseAmount } from "../money.js";
import { recomputeWatchlist } from "../watchlist.js";
import { coingeckoIdr, feedError, GOLD_YAHOO_SYMBOL, goldPerGramIdr, yahooQuote } from "./feeds.js";
import { fillHistory } from "./history.js";
import { FX_SYMBOL, latestPrices, savePrice } from "./store.js";

export async function refreshPrices(db: Db) {
  const { rows: assets } = await db.query<Asset>("select * from assets order by id");
  const date = today();
  const updated: Array<{ symbol: string; price: string; currency: string }> = [];
  const failed: Array<{ symbol: string; error: string }> = [];
  const manual = assets.filter((a) => a.price_source === "manual").map((a) => a.symbol);

  const store = async (asset: Asset, price: Decimal, source: string) => {
    await savePrice(db, asset, date, price, source);
    updated.push({ symbol: asset.symbol, price: price.toString(), currency: asset.currency });
  };

  // Several accounts can hold the same ticker; ask the feed once.
  const quotes = new Map<string, ReturnType<typeof yahooQuote>>();
  const quote = (symbol: string) => {
    const known = quotes.get(symbol);
    if (known) return known;
    const fresh = yahooQuote(symbol);
    quotes.set(symbol, fresh);
    return fresh;
  };

  let usdIdr: Decimal | undefined;
  const fx = assets.find((a) => a.symbol === FX_SYMBOL) as Asset;
  try {
    usdIdr = (await quote(fx.source_id as string)).price;
    await store(fx, usdIdr, "yahoo");
  } catch (err) {
    failed.push({ symbol: fx.symbol, error: feedError(err) });
    const fallback = (await latestPrices(db)).get(fx.id);
    usdIdr = fallback?.close;
  }

  for (const asset of assets.filter((a) => a.price_source === "yahoo" && a.symbol !== FX_SYMBOL)) {
    try {
      const feed = await quote(asset.source_id ?? asset.symbol);
      if (feed.currency !== asset.currency) {
        throw new Error(`feed quotes ${feed.currency}, asset is in ${asset.currency}`);
      }
      await store(asset, feed.price, "yahoo");
      // A new asset only knows its ticker until the feed says what it's called.
      if (feed.name && asset.name === asset.symbol) {
        await db.query("update assets set name = $2 where id = $1", [asset.id, feed.name]);
      }
    } catch (err) {
      failed.push({ symbol: asset.symbol, error: feedError(err) });
    }
  }

  const coins = assets.filter((a) => a.price_source === "coingecko");
  if (coins.length > 0) {
    try {
      const coinQuotes = await coingeckoIdr([...new Set(coins.map((c) => c.source_id as string))]);
      for (const coin of coins) {
        const price = coinQuotes.get(coin.source_id as string);
        if (price) await store(coin, price, "coingecko");
        else failed.push({ symbol: coin.symbol, error: `CoinGecko has no ${coin.source_id}` });
      }
    } catch (err) {
      for (const coin of coins) failed.push({ symbol: coin.symbol, error: feedError(err) });
    }
  }

  for (const gold of assets.filter((a) => a.price_source === "xau")) {
    try {
      if (!usdIdr) throw new Error("no USD/IDR rate available");
      const { price } = await quote(GOLD_YAHOO_SYMBOL);
      await store(gold, goldPerGramIdr(price, usdIdr).toDecimalPlaces(2), "xau");
    } catch (err) {
      failed.push({ symbol: gold.symbol, error: feedError(err) });
    }
  }

  const entered_zone = await recomputeWatchlist(db);
  const history = await fillHistory(db);
  return { date, updated, failed, manual_skipped: manual, entered_zone, history };
}

/** Refreshes only if the asset has no price yet; a feed failure here must not block saving the item. */
export async function ensurePrice(db: Db, assetId: number): Promise<void> {
  if ((await latestPrices(db)).has(assetId)) return;
  await refreshPrices(db);
}

export async function setPrice(db: Db, symbol: string, price: string | number, date?: string) {
  const asset = await requireAsset(db, symbol);
  if (asset.class === "fx") throw new LadderError(`${asset.symbol} is Ladder's shared exchange rate and can't be set by hand`);
  const close = parseAmount(price, "price");
  if (!close.greaterThan(0)) throw new LadderError("price must be above zero");
  const day = date ?? today();
  await savePrice(db, asset, day, close, "manual");
  const entered_zone = await recomputeWatchlist(db);
  return {
    symbol: asset.symbol,
    price: close.toString(),
    currency: asset.currency,
    date: day,
    entered_zone,
    note:
      asset.price_source === "manual"
        ? "This asset only uses manual prices."
        : `The next refresh replaces this with ${asset.price_source}. To keep manual prices, set its price_source to manual.`,
  };
}
