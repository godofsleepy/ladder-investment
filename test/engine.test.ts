import { describe, expect, it } from "vitest";
import { replay, zoneDistance, type EngineTrade, type TradeType } from "../src/engine.js";
import { Decimal, LadderError, parseAmount } from "../src/money.js";
import { goldPerGramIdr } from "../src/prices/feeds.js";

let nextId = 1;
function t(type: TradeType, qty: number | string, price: number | string, fee = 0, date = "2026-01-01", fx = 1): EngineTrade {
  return { id: nextId++, type, qty: new Decimal(qty), price: new Decimal(price), fee: new Decimal(fee), fx: new Decimal(fx), date };
}

describe("average cost", () => {
  it("adds fees to cost and averages across buys", () => {
    const p = replay([t("buy", 10, 100, 10), t("buy", 10, 200, 0, "2026-01-02")]);
    expect(p.qty.toString()).toBe("20");
    expect(p.cost.toString()).toBe("3010");
    expect(p.avgCost.toString()).toBe("150.5");
  });

  it("realizes gains against average cost, net of the sell fee", () => {
    const p = replay([
      t("buy", 10, 100, 10),
      t("buy", 10, 200, 0, "2026-01-02"),
      t("sell", 5, 300, 15, "2026-01-03"),
    ]);
    expect(p.realized.toString()).toBe("732.5");
    expect(p.cost.toString()).toBe("2257.5");
    expect(p.qty.toString()).toBe("15");
    expect(p.avgCost.toString()).toBe("150.5");
  });

  it("starts fresh after a position is fully sold", () => {
    const p = replay([
      t("buy", 3, 100),
      t("sell", 3, 110, 0, "2026-01-02"),
      t("buy", 1, 500, 0, "2026-01-03"),
    ]);
    expect(p.realized.toString()).toBe("30");
    expect(p.avgCost.toString()).toBe("500");
  });

  it("leaves no dust after thirds that don't divide evenly", () => {
    const p = replay([
      t("buy", 3, 100, 1),
      t("sell", 1, 100, 0, "2026-01-02"),
      t("sell", 1, 100, 0, "2026-01-03"),
      t("sell", 1, 100, 0, "2026-01-04"),
    ]);
    expect(p.qty.isZero()).toBe(true);
    expect(p.cost.isZero()).toBe(true);
    expect(p.realized.toDecimalPlaces(10).toString()).toBe("-1");
  });

  it("handles the PRD's BTC example", () => {
    const fee = new Decimal("0.01").times("1100000000").times("0.3").div(100);
    const p = replay([t("buy", "0.01", 1_100_000_000, fee.toNumber())]);
    expect(p.cost.toString()).toBe("11033000");
  });

  it("locks IDR cost at the trade-date rate", () => {
    const p = replay([t("buy", 2, 100, 0, "2026-01-01", 16000)]);
    expect(p.cost.toString()).toBe("3200000");
  });

  it("counts dividends and standalone fees as realized without changing cost", () => {
    const p = replay([
      t("buy", 100, 10),
      t("dividend", 100, 2, 5, "2026-01-02"),
      t("fee", 0, 0, 7, "2026-01-03"),
    ]);
    expect(p.income.toString()).toBe("195");
    expect(p.realized.toString()).toBe("188");
    expect(p.cost.toString()).toBe("1000");
  });

  it("treats a deposit as holdings brought in at cost", () => {
    expect(replay([t("deposit", 5, 40)]).cost.toString()).toBe("200");
  });

  it("refuses to sell more than was held on that date", () => {
    expect(() => replay([t("sell", 1, 100, 0, "2026-01-01"), t("buy", 1, 100, 0, "2026-01-02")])).toThrow(LadderError);
  });

  it("orders same-day buys before sells", () => {
    const sell = t("sell", 1, 120, 0, "2026-01-05");
    const buy = t("buy", 1, 100, 0, "2026-01-05");
    expect(replay([sell, buy]).realized.toString()).toBe("20");
  });
});

describe("parseAmount", () => {
  it.each([
    ["1.1B", "1100000000"],
    ["750k", "750000"],
    ["1.5m", "1500000"],
    ["1,400", "1400"],
    ["1,400.50", "1400.5"],
    ["1.400.000", "1400000"],
    ["0.015", "0.015"],
    ["3800", "3800"],
  ])("reads %s", (input, expected) => {
    expect(parseAmount(input).toString()).toBe(expected);
  });

  it("keeps JSON numbers as given", () => {
    expect(parseAmount(1.4).toString()).toBe("1.4");
  });

  it.each(["1.400", "abc", "1,5", ""])("refuses %j", (input) => {
    expect(() => parseAmount(input)).toThrow(LadderError);
  });
});

describe("zones and gold", () => {
  it("measures distance from the nearest edge", () => {
    const d = (p: number) => zoneDistance(new Decimal(p), new Decimal(100), new Decimal(200));
    expect(d(210).side).toBe("above");
    expect(d(210).pct.toString()).toBe("5");
    expect(d(90).side).toBe("below");
    expect(d(90).pct.toString()).toBe("10");
    expect(d(100).side).toBe("inside");
    expect(d(200).side).toBe("inside");
  });

  it("converts USD per ounce to IDR per gram", () => {
    const perGram = goldPerGramIdr(new Decimal(4000), new Decimal(18000));
    expect(perGram.toDecimalPlaces(2).toString()).toBe("2314853.75");
  });
});
