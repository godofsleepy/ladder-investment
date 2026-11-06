import type { Db } from "./db.js";
import { LadderError } from "./money.js";

export type AssetClass = "crypto" | "us_stock" | "idx_stock" | "gold" | "bond" | "other";
export type PriceSource = "coingecko" | "yahoo" | "xau" | "manual";

export interface Asset {
  id: number;
  symbol: string;
  name: string;
  class: AssetClass | "fx";
  currency: "IDR" | "USD";
  price_source: PriceSource;
  source_id: string | null;
}

export interface NewAssetHints {
  asset_class?: AssetClass;
  name?: string;
  currency?: "IDR" | "USD";
  source_id?: string;
}

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  USDT: "tether",
  USDC: "usd-coin",
};

const GOLD_ALIASES = new Set(["XAU", "GOLD", "EMAS"]);

function normalize(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return GOLD_ALIASES.has(s) ? "XAU" : s;
}

/** Finds an asset by symbol, also matching "BBRI" to an existing "BBRI.JK". */
export async function findAsset(db: Db, symbol: string): Promise<Asset | undefined> {
  const s = normalize(symbol);
  const { rows } = await db.query<Asset>(
    "select * from assets where symbol = $1 or symbol = $1 || '.JK' order by symbol = $1 desc limit 1",
    [s],
  );
  return rows[0];
}

export async function requireAsset(db: Db, symbol: string): Promise<Asset> {
  const asset = await findAsset(db, symbol);
  if (!asset) throw new LadderError(`No asset called ${symbol} yet`);
  return asset;
}

/** USD/IDR is shared by every account, so no account can trade it or change it. */
function assertOwnable(asset: Asset): void {
  if (asset.class === "fx") throw new LadderError(`${asset.symbol} is Ladder's shared exchange rate, not an asset`);
}

function describeNew(symbol: string, hints: NewAssetHints): Omit<Asset, "id"> {
  const s = normalize(symbol);
  const inferred: AssetClass | undefined =
    hints.asset_class ??
    (s.endsWith(".JK") ? "idx_stock" : s === "XAU" ? "gold" : CRYPTO_IDS[s] ? "crypto" : undefined);

  switch (inferred) {
    case "idx_stock": {
      const sym = s.endsWith(".JK") ? s : `${s}.JK`;
      return base(sym, "idx_stock", "IDR", "yahoo", hints.source_id ?? sym);
    }
    case "us_stock":
      return base(s, "us_stock", "USD", "yahoo", hints.source_id ?? s);
    case "gold":
      return { ...base("XAU", "gold", "IDR", "xau", null), name: hints.name ?? "Gold (per gram)" };
    case "crypto": {
      const id = hints.source_id ?? CRYPTO_IDS[s];
      if (!id) {
        throw new LadderError(`${s} is not a known coin: pass source_id with its CoinGecko id`);
      }
      return { ...base(s, "crypto", "IDR", "coingecko", id), name: hints.name ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ") };
    }
    case "bond":
      return base(s, "bond", hints.currency ?? "IDR", "manual", null);
    case "other":
      return base(s, "other", hints.currency ?? "IDR", "manual", null);
    default:
      throw new LadderError(
        `Don't know what ${s} is. Pass asset_class (crypto, us_stock, idx_stock, gold, bond, other). Indonesian stocks can also use the .JK suffix, e.g. ${s}.JK`,
      );
  }

  function base(
    sym: string,
    cls: AssetClass,
    currency: "IDR" | "USD",
    source: PriceSource,
    sourceId: string | null,
  ): Omit<Asset, "id"> {
    return {
      symbol: sym,
      name: hints.name ?? sym,
      class: cls,
      currency,
      price_source: source,
      source_id: sourceId,
    };
  }
}

export async function ensureAsset(db: Db, symbol: string, hints: NewAssetHints = {}): Promise<Asset> {
  const existing = await findAsset(db, symbol);
  if (existing) {
    assertOwnable(existing);
    return existing;
  }
  const a = describeNew(symbol, hints);
  const again = await findAsset(db, a.symbol);
  if (again) return again;
  const { rows } = await db.query<Asset>(
    `insert into assets (symbol, name, class, currency, price_source, source_id)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [a.symbol, a.name, a.class, a.currency, a.price_source, a.source_id],
  );
  return rows[0] as Asset;
}

export async function updateAsset(
  db: Db,
  symbol: string,
  changes: { name?: string; price_source?: PriceSource; source_id?: string },
): Promise<Asset> {
  const asset = await requireAsset(db, symbol);
  assertOwnable(asset);
  const { rows } = await db.query<Asset>(
    `update assets set name = coalesce($2, name), price_source = coalesce($3, price_source),
       source_id = coalesce($4, source_id) where id = $1 returning *`,
    [asset.id, changes.name ?? null, changes.price_source ?? null, changes.source_id ?? null],
  );
  return rows[0] as Asset;
}
