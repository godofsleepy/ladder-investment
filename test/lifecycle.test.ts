import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUser } from "../src/auth.js";
import { addDays, addMonths, today } from "../src/dates.js";
import { closePool, getPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createServer } from "../src/tools.js";

const quotes: Record<string, { price: number; currency: string }> = {
  "IDR=X": { price: 18000, currency: "IDR" },
  "GC=F": { price: 4000, currency: "USD" },
  "ANTM.JK": { price: 1600, currency: "IDR" },
  "BBRI.JK": { price: 4000, currency: "IDR" },
  AAPL: { price: 150, currency: "USD" },
};
const coins: Record<string, number> = { bitcoin: 1_200_000_000 };

function fakeFetch(input: string | URL) {
  const url = new URL(String(input));
  if (url.hostname === "api.coingecko.com") {
    const ids = (url.searchParams.get("ids") ?? "").split(",");
    return Response.json(Object.fromEntries(ids.map((id) => [id, { idr: coins[id] }])));
  }
  const symbol = decodeURIComponent(url.pathname.split("/").pop() as string);
  const quote = quotes[symbol];
  if (!quote) return Response.json({ chart: { result: null, error: { description: "Not Found" } } });
  return Response.json({
    chart: {
      result: [
        {
          meta: { currency: quote.currency, regularMarketPrice: quote.price },
          indicators: { quote: [{ close: [quote.price] }] },
        },
      ],
    },
  });
}

const client = new Client({ name: "test", version: "1" });

async function raw(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { text: res.content[0]?.text ?? "", isError: res.isError ?? false };
}

// biome-ignore lint: tool results are loose JSON
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await raw(name, args);
  if (res.isError) throw new Error(`${name}: ${res.text}`);
  return JSON.parse(res.text);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => fakeFetch(input)));
  await migrate();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const user = await createUser(getPool(), { email: "lifecycle@example.com", name: "Lifecycle", password: "correct horse" });
  await createServer({ userId: user.id, access: "rw" }).connect(a);
  await client.connect(b);
});

afterAll(async () => {
  await client.close();
  await closePool();
  vi.unstubAllGlobals();
});

describe("PRD lifecycle over MCP", () => {
  const day = today();

  it("exposes every PRD tool", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of [
      "log_trade", "import_trades", "get_portfolio", "get_allocation", "get_asset_detail",
      "add_to_watchlist", "get_watchlist", "update_watchlist_item", "save_thesis", "review_thesis",
      "close_thesis", "check_alerts", "add_note", "search_notes", "refresh_prices",
    ]) {
      expect(names).toContain(tool);
    }
  });

  it("logs the PRD's one-sentence BTC trade", async () => {
    const res = await call("log_trade", { symbol: "BTC", type: "buy", qty: 0.01, price: "1.1B", fee_pct: 0.3, platform: "Indodax" });
    expect(res.position.cost_idr).toBe("11033000.00");
    expect(res.prompts[0]).toContain("no thesis");
  });

  it("asks what an unknown symbol is instead of guessing", async () => {
    const res = await raw("log_trade", { symbol: "ANTM", type: "buy", qty: 1, price: 1500 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("asset_class");
  });

  it("refuses an oversell and leaves nothing behind", async () => {
    const res = await raw("log_trade", { symbol: "BTC", type: "sell", qty: 1, price: "1.2B" });
    expect(res.isError).toBe(true);
    const detail = await call("get_asset_detail", { symbol: "BTC" });
    expect(detail.trades).toHaveLength(1);
  });

  it("flags a missing price rather than valuing it at zero", async () => {
    await call("log_trade", { symbol: "ORI025", type: "buy", qty: 10, price: 1000000, asset_class: "bond", platform: "Bibit" });
    const p = await call("get_portfolio");
    expect(p.holdings.find((h: { symbol: string }) => h.symbol === "ORI025").value_idr).toBeNull();
    expect(p.warnings.join()).toContain("no price");
  });

  it("values USD and gold holdings in IDR after a refresh", async () => {
    await call("log_trade", { symbol: "AAPL", type: "buy", qty: 2, price: 100, fx_rate: 16000, asset_class: "us_stock", platform: "Gotrade" });
    await call("log_trade", { symbol: "gold", type: "buy", qty: 10, price: 2_000_000, platform: "Pluang" });
    const refresh = await call("refresh_prices");
    expect(refresh.failed).toEqual([]);

    const p = await call("get_portfolio");
    const by = (s: string) => p.holdings.find((h: { symbol: string }) => h.symbol === s);
    expect(by("BTC").value_idr).toBe("12000000.00");
    expect(by("BTC").unrealized_idr).toBe("967000.00");
    expect(by("AAPL").cost_idr).toBe("3200000.00");
    expect(by("AAPL").value_idr).toBe("5400000.00");
    expect(by("XAU").value_idr).toBe("23148537.50");
    expect(p.totals.value_idr).toBe("40548537.50");
  });

  it("splits allocation by class and platform to the same total", async () => {
    const byClass = await call("get_allocation", { group_by: "class" });
    const byPlatform = await call("get_allocation", { group_by: "platform" });
    expect(byClass.total_idr).toBe("40548537.50");
    expect(byPlatform.total_idr).toBe("40548537.50");
    expect(byPlatform.groups.map((g: { group: string }) => g.group)).toContain("Indodax");
  });

  let itemId: number;
  let thesisId: number;

  it("watches an idea and shows its distance to the zone", async () => {
    const res = await call("add_to_watchlist", {
      symbol: "ANTM.JK", zone_low: "1,400", zone_high: "1,550", reason: "Nickel recovery", priority: "high",
    });
    itemId = res.item.id;
    expect(res.item.status).toBe("watching");
    expect(res.item.distance).toBe("3.23% above zone");
  });

  it("keeps the draft thesis off the active list", async () => {
    const draft = await call("save_thesis", {
      symbol: "ANTM.JK", title: "Nickel recovery", why: "Nickel price bottoming.", kill_criteria: "Nickel below 14k",
      horizon: "1y", conviction: 4, kill_price: 1300, target_price: 2200,
    });
    thesisId = draft.id;
    expect(draft.status).toBe("draft");
    expect(draft.next_review).toBe(addMonths(day, 3));
  });

  it("triggers when price enters the zone", async () => {
    quotes["ANTM.JK"] = { price: 1500, currency: "IDR" };
    const refresh = await call("refresh_prices");
    expect(refresh.entered_zone[0].symbol).toBe("ANTM.JK");
    const alerts = await call("check_alerts");
    expect(alerts.watchlist_in_zone[0].id).toBe(itemId);
    expect(alerts.positions_without_thesis).toEqual(expect.arrayContaining(["BTC", "AAPL", "XAU"]));
  });

  it("marks the item bought and activates the draft on buy", async () => {
    const res = await call("log_trade", { symbol: "ANTM", type: "buy", qty: 100, price: 1500, platform: "Stockbit" });
    expect(res.watchlist_bought).toBe(itemId);
    expect(res.thesis_activated).toBe(thesisId);
    const history = await call("get_watchlist", { status: "history" });
    expect(history.items[0].status).toBe("bought");
    expect(history.items[0].owned_qty).toBe("100");
  });

  it("keeps one thesis when buying more", async () => {
    const res = await call("log_trade", { symbol: "ANTM.JK", type: "buy", qty: 100, price: 1500 });
    expect(res.prompts[0]).toContain("Offer to add a note");
    const dup = await raw("save_thesis", {
      symbol: "ANTM.JK", title: "x", why: "x", kill_criteria: "x", horizon: "1y", conviction: 1,
    });
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain("review_thesis");
  });

  it("flags the kill price, then stays quiet once reviewed", async () => {
    quotes["ANTM.JK"] = { price: 1250, currency: "IDR" };
    await call("refresh_prices");
    const flagged = await call("check_alerts");
    expect(flagged.theses_needing_review[0].triggers[0]).toContain("kill price");

    await call("review_thesis", { thesis_id: thesisId, still_valid: true, note: "Nickel fine", next_review: addDays(day, 30) });
    expect((await call("check_alerts")).theses_needing_review).toEqual([]);
  });

  it("flags again when the kill price is moved past the current price", async () => {
    await call("review_thesis", { thesis_id: thesisId, still_valid: true, changes: { kill_price: 1200, conviction: 3 } });
    quotes["ANTM.JK"] = { price: 1150, currency: "IDR" };
    await call("refresh_prices");
    expect((await call("check_alerts")).theses_needing_review).toHaveLength(1);
  });

  it("keeps the old version on update", async () => {
    const detail = await call("get_asset_detail", { symbol: "ANTM.JK" });
    const update = detail.thesis_reviews.find((r: { action: string }) => r.action === "update");
    expect(update.snapshot.conviction).toBe(4);
    expect(detail.thesis.conviction).toBe(3);
  });

  it("flags a passed review date", async () => {
    await getPool().query("update theses set next_review_at = $2 where id = $1", [thesisId, addDays(day, -1)]);
    const alerts = await call("check_alerts");
    expect(alerts.theses_needing_review[0].triggers.join()).toContain("Review date");
    await getPool().query("update theses set next_review_at = $2 where id = $1", [thesisId, addDays(day, 30)]);
  });

  it("prompts to close on a full sale, then scores the call", async () => {
    const res = await call("log_trade", { symbol: "ANTM.JK", type: "sell", qty: 200, price: 1150 });
    expect(res.prompts[0]).toContain("close_thesis");
    expect(res.position.realized_idr).toBe("-70000.00");

    const closed = await call("close_thesis", { thesis_id: thesisId, status: "invalidated", outcome: "wrong", note: "Exited" });
    expect(closed.realized_idr).toBe("-70000.00");
    const list = await call("get_theses", { status: "invalidated" });
    expect(list[0].outcome).toBe("wrong");
    expect((await call("get_portfolio")).closed_positions[0].symbol).toBe("ANTM.JK");
  });

  it("finds notes and theses by keyword", async () => {
    await call("add_note", { body: "Central bank buying keeps rising", symbol: "XAU", tags: ["macro"] });
    const notes = await call("search_notes", { text: "central rising" });
    expect(notes.matches[0].kind).toBe("note");
    const thesis = await call("search_notes", { text: "nickel bottoming" });
    expect(thesis.matches[0].kind).toBe("thesis");
    expect((await call("search_notes", { text: "100%" })).count).toBe(0);
  });

  it("drops an item with a reason and needs one", async () => {
    const add = await call("add_to_watchlist", { symbol: "BBRI.JK", zone_low: 3800, zone_high: 4100, reason: "Yield" });
    expect(add.item.status).toBe("triggered");
    const refused = await raw("update_watchlist_item", { item_id: add.item.id, status: "dropped" });
    expect(refused.isError).toBe(true);
    const dropped = await call("update_watchlist_item", { item_id: add.item.id, status: "dropped", drop_reason: "Found better" });
    expect(dropped.status).toBe("dropped");
  });

  it("imports CSV, skips duplicates and bad rows, and is safe to re-run", async () => {
    const csv = [
      "symbol,type,qty,price,fee,date,asset_class",
      `BBRI.JK,sell,10,4100,0,${day},`,
      `BBRI.JK,buy,50,3900,1000,${day},`,
      `NOPE,buy,1,1,0,${day},`,
      `BBRI.JK,buy,1,1,0,not-a-date,`,
    ].join("\n");
    const first = await call("import_trades", { csv, platform: "Stockbit" });
    expect(first.rows_added).toBe(2);
    expect(first.skipped.map((s: { line: number }) => s.line)).toEqual([4, 5]);

    const second = await call("import_trades", { csv, platform: "Stockbit" });
    expect(second.rows_added).toBe(0);
    const detail = await call("get_asset_detail", { symbol: "BBRI" });
    expect(detail.position.qty).toBe("40");
  });

  it("deletes a mistaken trade only when nothing depends on it", async () => {
    const { trades } = await call("get_asset_detail", { symbol: "BBRI.JK" });
    const buy = trades.find((t: { type: string }) => t.type === "buy");
    const sell = trades.find((t: { type: string }) => t.type === "sell");
    expect((await raw("delete_trade", { trade_id: buy.id })).isError).toBe(true);
    await call("delete_trade", { trade_id: sell.id });
    expect((await call("get_asset_detail", { symbol: "BBRI.JK" })).position.qty).toBe("50");
  });

  it("keeps last price, lists the failure, and allows a manual price", async () => {
    delete quotes["AAPL"];
    const refresh = await call("refresh_prices");
    expect(refresh.failed.map((f: { symbol: string }) => f.symbol)).toEqual(["AAPL"]);
    const before = await call("get_asset_detail", { symbol: "AAPL" });
    expect(before.position.price).toBe("150");

    await call("update_asset", { symbol: "XAU", price_source: "manual" });
    await call("set_price", { symbol: "XAU", price: "2.5m" });
    const after = await call("refresh_prices");
    expect(after.manual_skipped).toContain("XAU");
    expect((await call("get_asset_detail", { symbol: "XAU" })).position.value_idr).toBe("25000000.00");
  });

  it("looks up the trade-date rate when a USD trade has none", async () => {
    quotes["AAPL"] = { price: 150, currency: "USD" };
    const res = await call("log_trade", { symbol: "AAPL", type: "buy", qty: 1, price: 100, date: addDays(day, -30) });
    expect(res.trade.fx_to_idr).toBe("18000");
  });

  it("values the portfolio as of a past date", async () => {
    const past = await call("get_portfolio", { as_of: addDays(day, -60) });
    expect(past.holdings).toEqual([]);
  });

  it("saves review answers to the journal", async () => {
    const notes = await call("search_notes", { tag: "review" });
    expect(notes.matches.map((n: { text: string }) => n.text)).toEqual(expect.arrayContaining(["Nickel fine", "Exited"]));
  });

  it("scores closed theses and leaves mixed out of the hit rate", async () => {
    const save = (symbol: string, conviction: number) =>
      call("save_thesis", { symbol, title: "t", why: "w", kill_criteria: "k", horizon: "1y", conviction });
    const a = await save("BTC", 5);
    const b = await save("AAPL", 5);
    await call("close_thesis", { thesis_id: a.id, status: "achieved", outcome: "right" });
    await call("close_thesis", { thesis_id: b.id, status: "closed", outcome: "mixed" });

    const card = await call("get_scorecard");
    expect(card.overall).toMatchObject({ total: 3, right: 1, wrong: 1, mixed: 1, hit_rate_pct: "50.00" });
    expect(card.by_conviction[0]).toMatchObject({ conviction: 5, total: 2, hit_rate_pct: "100.00" });
    expect(card.by_class.find((c: { class: string }) => c.class === "us_stock").hit_rate_pct).toBeNull();
  });

  it("adds Guardian cash to Ladder assets", async () => {
    const assets = (await call("get_portfolio")).totals.value_idr;
    const res = await call("get_net_worth", { guardian_cash_idr: "10m" });
    expect(res.guardian_cash_idr).toBe("10000000.00");
    expect(res.ladder_assets_idr).toBe(assets);
    expect(Number(res.net_worth_idr)).toBeCloseTo(Number(assets) + 10_000_000, 2);
  });

  it("offers the weekly review as a prompt", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("weekly_review");
    const prompt = await client.getPrompt({ name: "weekly_review" });
    expect(JSON.stringify(prompt.messages)).toContain("check_alerts");
  });

  it("rejects future dates", async () => {
    const res = await raw("log_trade", { symbol: "BTC", type: "buy", qty: 1, price: 1, date: addDays(day, 2) });
    expect(res.isError).toBe(true);
  });
});
