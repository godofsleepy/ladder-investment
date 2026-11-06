import { Decimal, LadderError } from "./money.js";

export type TradeType = "buy" | "sell" | "dividend" | "fee" | "deposit";

export interface EngineTrade {
  id: number;
  type: TradeType;
  qty: Decimal;
  price: Decimal;
  fee: Decimal;
  /** Multiplier into the reporting currency. */
  fx: Decimal;
  date: string;
}

export interface Position {
  qty: Decimal;
  /** Cost basis of what is still held, fees included. */
  cost: Decimal;
  avgCost: Decimal;
  realizedTrading: Decimal;
  income: Decimal;
  feesPaid: Decimal;
  /** Trading gains plus dividends, less standalone fees. */
  realized: Decimal;
}

const ZERO = new Decimal(0);

/** Same-day buys go before sells, so exports listed newest-first still replay. */
export function sortTrades<T extends Pick<EngineTrade, "id" | "type" | "date">>(trades: T[]): T[] {
  const rank = (t: T) => (t.type === "buy" || t.type === "deposit" ? 0 : 1);
  return [...trades].sort(
    (a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.id - b.id,
  );
}

/** Moving weighted average cost. Throws if any sell exceeds the quantity held at that point. */
export function replay(trades: EngineTrade[]): Position {
  let held = ZERO;
  let cost = ZERO;
  let realizedTrading = ZERO;
  let income = ZERO;
  let feesPaid = ZERO;

  for (const t of sortTrades(trades)) {
    const gross = t.qty.times(t.price);
    switch (t.type) {
      case "buy":
      case "deposit":
        held = held.plus(t.qty);
        cost = cost.plus(gross.plus(t.fee).times(t.fx));
        break;
      case "sell": {
        if (t.qty.greaterThan(held)) {
          throw new LadderError(
            `Selling ${t.qty.toString()} on ${t.date} is more than the ${held.toString()} held on that date`,
          );
        }
        const basis = cost.div(held).times(t.qty);
        realizedTrading = realizedTrading.plus(gross.minus(t.fee).times(t.fx)).minus(basis);
        cost = cost.minus(basis);
        held = held.minus(t.qty);
        if (held.isZero()) cost = ZERO;
        break;
      }
      case "dividend":
        income = income.plus(gross.minus(t.fee).times(t.fx));
        break;
      case "fee":
        feesPaid = feesPaid.plus(t.fee.times(t.fx));
        break;
    }
  }

  return {
    qty: held,
    cost,
    avgCost: held.isZero() ? ZERO : cost.div(held),
    realizedTrading,
    income,
    feesPaid,
    realized: realizedTrading.plus(income).minus(feesPaid),
  };
}

export type ZoneSide = "above" | "below" | "inside";

export function zoneDistance(
  price: Decimal,
  low: Decimal,
  high: Decimal,
): { side: ZoneSide; pct: Decimal } {
  if (price.greaterThan(high)) return { side: "above", pct: price.minus(high).div(high).times(100) };
  if (price.lessThan(low)) return { side: "below", pct: low.minus(price).div(low).times(100) };
  return { side: "inside", pct: new Decimal(0) };
}
