import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUser, deleteUser, type User } from "../src/auth.js";
import { addDays, today } from "../src/dates.js";
import { closePool, getPool, withUser } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { Decimal } from "../src/money.js";
import { assetOptions, getGrowth, getMacroView, getPositions, getPriceChart, getPriceStatus, ignoreAlert, previewTrade, restoreAlert } from "../src/overview.js";
import { fillAssetHistory, fillHistory } from "../src/prices/history.js";
import { savePrice } from "../src/prices/store.js";
import { createServer } from "../src/tools.js";
import { getTradeLog } from "../src/trades.js";
import { linkMacroAsset, unlinkMacroAsset } from "../src/macro.js";

const day = today();
let history: Record<string, Array<[string, number]>> = {};

/** A Yahoo chart answer built from dates and closes, in UTC. */
function chart(symbol: string) {
  const rows = history[symbol] ?? [];
  return Response.json({
    chart: {
      result: [
        {
          meta: { currency: "USD", regularMarketPrice: rows.at(-1)?.[1] ?? 1, gmtoffset: 0 },
          timestamp: rows.map(([d]) => Date.parse(`${d}T12:00:00Z`) / 1000),
          indicators: { quote: [{ close: rows.map(([, c]) => c) }] },
        },
      ],
    },
  });
}

let user: User;
let other: User;
let mcp: Client;

async function connect(id: number) {
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer({ userId: id, access: "rw" }).connect(a);
  await client.connect(b);
  return client;
}

// biome-ignore lint: tool results are loose JSON
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  const text = res.content[0]?.text ?? "";
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "api.coingecko.com") return Response.json({});
    return chart(decodeURIComponent(url.pathname.split("/").pop() as string));
  }));
  await migrate();
  user = await createUser(getPool(), { email: "canvas@example.com", name: "Canvas", password: "correct horse" });
  other = await createUser(getPool(), { email: "canvas2@example.com", name: "Other", password: "correct horse" });
  mcp = await connect(user.id);
});

afterAll(async () => {
  await mcp.close();
  await deleteUser(getPool(), user.id);
  await deleteUser(getPool(), other.id);
  await closePool();
  vi.unstubAllGlobals();
});

const read = <T>(fn: (db: Parameters<Parameters<typeof withUser>[1]>[0]) => Promise<T>) =>
  withUser(user.id, fn, { readOnly: true });

describe("position status", () => {
  beforeAll(async () => {
    await call(mcp, "log_trade", { symbol: "BBRI.JK", type: "buy", qty: 100, price: 4000 });
    await call(mcp, "log_trade", { symbol: "BBCA.JK", type: "buy", qty: 100, price: 8000 });
    await call(mcp, "log_trade", { symbol: "TLKM.JK", type: "buy", qty: 100, price: 3000 });
    await call(mcp, "log_trade", { symbol: "ASII.JK", type: "buy", qty: 100, price: 5000 });
    await call(mcp, "set_price", { symbol: "BBRI.JK", price: 3900 });
    await call(mcp, "set_price", { symbol: "BBCA.JK", price: 9000 });
    await call(mcp, "set_price", { symbol: "TLKM.JK", price: 3000 });
    await call(mcp, "set_price", { symbol: "ASII.JK", price: 5000 });
  });

  const state = async (symbol: string) => {
    const { positions } = await read((db) => getPositions(db));
    return positions.find((p) => p.symbol === symbol);
  };

  it("marks a position with no thesis", async () => {
    expect(await state("TLKM.JK")).toMatchObject({ state: "missing", reason: "none" });
  });

  it("alerts below the invalidation price", async () => {
    await call(mcp, "save_thesis", { symbol: "BBRI.JK", title: "Micro recovers", why: "", kill_criteria: "NPL up", horizon: "1y", conviction: 2, kill_price: 4000, add_rule: "No adds", trim_rule: "Above Rp5.200", review_every: "monthly" });
    expect(await state("BBRI.JK")).toMatchObject({ state: "alert", reason: "kill", kill_price: "4000" });
  });

  it("alerts when a position is over its weight cap", async () => {
    await call(mcp, "save_thesis", { symbol: "BBCA.JK", title: "Best bank", why: "", kill_criteria: "NPL", horizon: "1y", conviction: 5, max_weight_pct: 10 });
    expect(await state("BBCA.JK")).toMatchObject({ state: "alert", reason: "cap", cap_pct: 10 });
    const alerts = await call(mcp, "check_alerts");
    expect(alerts.overweight_positions[0]).toMatchObject({ symbol: "BBCA.JK", cap_pct: 10 });
  });

  it("marks a passed review date, and is on track otherwise", async () => {
    await call(mcp, "save_thesis", { symbol: "ASII.JK", title: "Dividends", why: "", kill_criteria: "x", horizon: "1y", conviction: 3 });
    expect(await state("ASII.JK")).toMatchObject({ state: "ok", reason: "next" });
    await getPool().query("update theses set next_review_at = $1 where user_id = $2 and title = 'Dividends'", [addDays(day, -1), user.id]);
    expect(await state("ASII.JK")).toMatchObject({ state: "review", reason: "date" });
  });

  it("uses the thesis cadence for the next review", async () => {
    const t = (await call(mcp, "get_theses", { symbol: "BBRI.JK" }))[0];
    expect(t).toMatchObject({ review_every: "monthly", add_rule: "No adds", trim_rule: "Above Rp5.200" });
    const res = await call(mcp, "review_thesis", { thesis_id: t.id, still_valid: true, note: "Holds" });
    expect(res.thesis.last_reviewed).toBe(day);
    expect(res.next_review > addDays(day, 27) && res.next_review < addDays(day, 32)).toBe(true);
  });
});

describe("macro views", () => {
  it("links holdings and works out real exposure", async () => {
    const view = await call(mcp, "save_macro_view", {
      short_name: "Rate cuts",
      area: "Indonesia",
      conviction: "Medium",
      view: "BI rate cuts lift Indonesian bank earnings.",
      wrong_if: "BI holds rates through mid-2027.",
      signals: [{ kind: "for", text: "BBCA NPL steady" }, { kind: "against", text: "BBRI micro NPL up" }],
      symbols: ["BBRI.JK", "BBCA"],
    });
    expect(view.symbols.sort()).toEqual(["BBCA.JK", "BBRI.JK"]);
    expect(view.exposure_idr).toBe("1290000.00");
    expect(view.state).toBe("holding");
    expect(view.signals[1].kind).toBe("against");
  });

  it("refuses to link an asset Ladder doesn't know", async () => {
    await expect(call(mcp, "save_macro_view", { short_name: "X", area: "Y", conviction: "Low", view: "v", wrong_if: "w", symbols: ["NOPE"] })).rejects.toThrow(/Don't know what NOPE is/);
  });

  it("shows a view past its date as review due, and problem views first", async () => {
    const overdue = await call(mcp, "save_macro_view", { short_name: "Old", area: "Global", conviction: "Low", view: "old", wrong_if: "w", next_review: addDays(day, -2) });
    expect(overdue.state).toBe("review");
    const weak = await call(mcp, "save_macro_view", { short_name: "Weak", area: "Global", conviction: "Low", status: "weak", view: "weak one", wrong_if: "w" });
    const list = await call(mcp, "get_macro_views");
    expect(list[0].id).toBe(weak.id);
    expect(list.at(-1).state).toBe("holding");
    await call(mcp, "delete_macro_view", { id: overdue.id });
    await call(mcp, "delete_macro_view", { id: weak.id });
  });

  it("updates in place and shows the narrowest view on a holding", async () => {
    const [first] = await call(mcp, "get_macro_views");
    await call(mcp, "save_macro_view", { id: first.id, short_name: "Rate cuts", area: "Indonesia", conviction: "High", view: first.view, wrong_if: first.wrong_if });
    expect((await call(mcp, "get_macro_views"))[0].symbols.length).toBe(2);
    await call(mcp, "save_macro_view", { short_name: "Only BBRI", area: "Indonesia", conviction: "Low", view: "just one", wrong_if: "w", symbols: ["BBRI.JK"] });
    const { positions } = await read((db) => getPositions(db));
    expect(positions.find((p) => p.symbol === "BBRI.JK")?.macro?.short_name).toBe("Only BBRI");
    expect(positions.find((p) => p.symbol === "BBCA.JK")?.macro?.short_name).toBe("Rate cuts");
  });

  it("changes only the fields an update passes", async () => {
    const view = await call(mcp, "save_macro_view", {
      short_name: "Keep me", area: "Global", conviction: "High", status: "weak", view: "Original view", why: "Original why",
      wrong_if: "Original wrong", signals: [{ kind: "for", text: "A signal" }], symbols: ["BBRI.JK"], next_review: addDays(day, 40),
    });
    const updated = await call(mcp, "save_macro_view", { id: view.id, conviction: "Low" });
    expect(updated).toMatchObject({
      short_name: "Keep me", area: "Global", conviction: "Low", status: "weak", view: "Original view", why: "Original why",
      wrong_if: "Original wrong", signals: [{ kind: "for", text: "A signal" }], symbols: ["BBRI.JK"], next_review: addDays(day, 40),
    });
    expect((await call(mcp, "save_macro_view", { id: view.id, symbols: [] })).symbols).toEqual([]);
    await expect(call(mcp, "save_macro_view", { short_name: "New", area: "Global" })).rejects.toThrow("A new macro view needs conviction, view, wrong_if");
    await call(mcp, "delete_macro_view", { id: view.id });
  });

  it("keeps macro views private to their account", async () => {
    const bob = await connect(other.id);
    expect(await call(bob, "get_macro_views")).toEqual([]);
    const [first] = await call(mcp, "get_macro_views");
    await expect(call(bob, "delete_macro_view", { id: first.id })).rejects.toThrow(/No macro view/);
    await expect(call(bob, "save_macro_view", { id: first.id, short_name: "x", area: "y", conviction: "Low", view: "v", wrong_if: "w" })).rejects.toThrow(/No macro view/);
    await bob.close();
  });
});

describe("trade preview", () => {
  it("uses the engine for a buy, including fees", async () => {
    const res = await read((db) => previewTrade(db, { symbol: "TLKM.JK", side: "buy", qty: 100, price: 4000, fee: 1000 }));
    expect(res).toMatchObject({ side: "buy", total: "401000", qty: "200", avg: "3505" });
  });

  it("shows realised profit on a sell, net of the fee", async () => {
    const res = await read((db) => previewTrade(db, { symbol: "TLKM.JK", side: "sell", qty: 50, price: 3500, fee: 500 }));
    expect(res).toMatchObject({ side: "sell", proceeds: "174500", qty: "50", realized: "24500" });
  });

  it("refuses to sell more than is held, and saves nothing", async () => {
    await expect(read((db) => previewTrade(db, { symbol: "TLKM.JK", side: "sell", qty: 500, price: 1 }))).rejects.toThrow(/You hold 100/);
    const held = await read((db) => db.query("select count(*)::int as n from trades t join assets a on a.id = t.asset_id where a.symbol = 'TLKM.JK'"));
    expect(held.rows[0].n).toBe(1);
  });

  it("previews a brand-new asset, and stays quiet until the form is filled", async () => {
    expect(await read((db) => previewTrade(db, { symbol: "NEW.JK", side: "buy", qty: 10, price: 100 }))).toMatchObject({ qty: "10", avg: "100" });
    expect(await read((db) => previewTrade(db, { symbol: "TLKM.JK", side: "buy", qty: 0, price: 100 }))).toBeNull();
  });
});

describe("growth and price history", () => {
  it("is empty before the first trade", async () => {
    expect(await withUser(other.id, (db) => getGrowth(db))).toEqual({ points: [], symbols: [] });
  });

  it("tracks real value and money invested over time", async () => {
    const carol = await createUser(getPool(), { email: "growth@example.com", name: "Growth", password: "correct horse" });
    const client = await connect(carol.id);
    const d = (n: number) => addDays(day, -n);
    await call(client, "log_trade", { symbol: "ANTM.JK", type: "buy", qty: 10, price: 1000, date: d(20) });
    await call(client, "log_trade", { symbol: "ANTM.JK", type: "buy", qty: 10, price: 2000, date: d(10) });
    await call(client, "log_trade", { symbol: "ANTM.JK", type: "sell", qty: 5, price: 3000, date: d(5) });
    await withUser(carol.id, async (db) => {
      const { rows } = await db.query("select * from assets where symbol = 'ANTM.JK'");
      await savePrice(db, rows[0], d(20), new Decimal(1000), "test");
      await savePrice(db, rows[0], d(15), new Decimal(1500), "test");
      await savePrice(db, rows[0], d(10), new Decimal(2000), "test");
      await savePrice(db, rows[0], d(5), new Decimal(3000), "test");
      await savePrice(db, rows[0], day, new Decimal(4000), "test");
    });

    const { points, symbols } = await withUser(carol.id, (db) => getGrowth(db), { readOnly: true });
    expect(symbols).toEqual(["ANTM.JK"]);
    const at = (n: number) => points.find((p) => p.date === d(n));
    expect(points[0]).toMatchObject({ date: d(20), value: 10000, invested: 10000 });
    expect(at(15)).toMatchObject({ value: 15000, invested: 10000 });
    expect(at(10)).toMatchObject({ value: 40000, invested: 30000 });
    expect(at(5)).toMatchObject({ value: 45000, invested: 22500 });
    expect(points.at(-1)).toMatchObject({ date: day, value: 60000, invested: 22500 });
    expect(points.at(-1)?.by["ANTM.JK"]).toBe(60000);

    const { portfolio } = await withUser(carol.id, (db) => getPositions(db), { readOnly: true });
    expect(portfolio.totals.value_idr).toBe("60000.00");
    await client.close();
    await deleteUser(getPool(), carol.id);
  });

  it("gives only current holdings a line, while sold ones still count in past value", async () => {
    const erin = await createUser(getPool(), { email: "sold@example.com", name: "Sold", password: "correct horse" });
    const client = await connect(erin.id);
    const d = (n: number) => addDays(day, -n);
    await call(client, "log_trade", { symbol: "ANTM.JK", type: "buy", qty: 10, price: 1000, date: d(20) });
    await call(client, "log_trade", { symbol: "ANTM.JK", type: "sell", qty: 10, price: 1000, date: d(10) });
    await call(client, "log_trade", { symbol: "BBRI.JK", type: "buy", qty: 10, price: 500, date: d(15) });
    await call(client, "log_trade", { symbol: "BBRI.JK", type: "sell", qty: 4, price: 500, date: d(5) });

    const { points, symbols } = await withUser(erin.id, (db) => getGrowth(db), { readOnly: true });
    expect(symbols).toEqual(["BBRI.JK"]);
    expect(points.find((p) => p.date === d(15))).toMatchObject({ value: 15000, invested: 15000 });
    expect(points.every((p) => !("ANTM.JK" in p.by))).toBe(true);
    await client.close();
    await deleteUser(getPool(), erin.id);
  });

  it("fetches real closes back to the first trade, and never overwrites a stored price", async () => {
    const dave = await createUser(getPool(), { email: "history@example.com", name: "History", password: "correct horse" });
    const client = await connect(dave.id);
    const d = (n: number) => addDays(day, -n);
    history = {
      "BMRI.JK": [[d(30), 5000], [d(29), 5100], [d(1), 5500]],
      "GC=F": [[d(30), 3000]],
      "IDR=X": [[d(40), 16000], [d(30), 16000]],
      "BTC-USD": [[d(30), 100000]],
    };
    await call(client, "log_trade", { symbol: "BMRI.JK", type: "buy", qty: 1, price: 5000, date: d(30) });
    await call(client, "log_trade", { symbol: "XAU", type: "buy", qty: 1, price: 1000000, date: d(30) });
    await call(client, "log_trade", { symbol: "BTC", type: "buy", qty: 1, price: 1000000, date: d(30) });
    await call(client, "set_price", { symbol: "BMRI.JK", price: 7777, date: d(29) });

    const res = await withUser(dave.id, (db) => fillHistory(db));
    expect(res.failed).toEqual([]);

    const closes = await withUser(dave.id, (db) => db.query(
      "select a.symbol, p.date, p.close from prices p join assets a on a.id = p.asset_id where p.date = any($1) order by 1,2",
      [[d(30), d(29)]],
    ));
    const get = (symbol: string, date: string) => closes.rows.find((r) => r.symbol === symbol && r.date === date)?.close;
    expect(get("BMRI.JK", d(30))).toBe("5000");
    expect(get("BMRI.JK", d(29))).toBe("7777");
    expect(get("BTC", d(30))).toBe("1600000000");
    expect(Number(get("XAU", d(30)))).toBeCloseTo((3000 / 31.1034768) * 16000, 1);

    const again = await withUser(dave.id, (db) => fillHistory(db));
    expect(again.filled).toEqual([]);
    history = {};
    await client.close();
    await deleteUser(getPool(), dave.id);
    // USD/IDR is shared between accounts, so this test's fake history mustn't outlive it.
    await getPool().query("delete from prices where date < $1 and asset_id = (select id from assets where symbol = 'USDIDR')", [day]);
  });

  it("reports when prices were fetched and the USD/IDR rate", async () => {
    await withUser(user.id, async (db) => {
      const { rows } = await db.query("select * from assets where symbol = 'USDIDR'");
      await savePrice(db, rows[0], day, new Decimal(18049), "test");
    });
    const status = await read((db) => getPriceStatus(db));
    expect(status.usd_idr).toBe("18049");
    expect(status.refreshed_at).toBeInstanceOf(Date);
  });

  it("lists this account's assets for the trade form, without the exchange rate", async () => {
    const options = await read((db) => assetOptions(db));
    expect(options.map((o) => o.symbol)).toContain("BBRI.JK");
    expect(options.map((o) => o.symbol)).not.toContain("USDIDR");
    expect(options.find((o) => o.symbol === "BBRI.JK")?.price).toBe("3900");
  });
});

describe("trade log", () => {
  let log: Client;
  let trader: User;
  const logRead = <T>(fn: (db: Parameters<Parameters<typeof withUser>[1]>[0]) => Promise<T>) =>
    withUser(trader.id, fn, { readOnly: true });

  beforeAll(async () => {
    trader = await createUser(getPool(), { email: "log@example.com", name: "Log", password: "correct horse" });
    log = await connect(trader.id);
    await call(log, "log_trade", { symbol: "UNVR.JK", type: "buy", qty: 100, price: 2000, fee: 500, date: "2026-01-10" });
    await call(log, "log_trade", { symbol: "UNVR.JK", type: "sell", qty: 40, price: 2500, fee: 100, date: "2026-02-10" });
    await call(log, "log_trade", { symbol: "UNVR.JK", type: "dividend", qty: 60, price: 50, date: "2026-02-11" });
    await call(log, "log_trade", { symbol: "NVDA", asset_class: "us_stock", type: "buy", qty: 2, price: 100, fee: 1, trade_currency: "USD", fx_rate: 16000, date: "2026-03-01" });
    await call(log, "log_trade", { symbol: "UNVR.JK", type: "fee", fee: 300, date: "2026-03-02" });
    await call(log, "log_trade", { symbol: "ADRO.JK", type: "deposit", qty: 10, price: 3000, date: "2026-03-03" });
  });

  afterAll(async () => {
    await log.close();
    await deleteUser(getPool(), trader.id);
  });

  it("lists every asset's trades newest first, with net amounts", async () => {
    const res = await logRead((db) => getTradeLog(db));
    expect(res.entries.map((e) => `${e.type} ${e.symbol}`)).toEqual([
      "deposit ADRO.JK", "fee UNVR.JK", "buy NVDA", "dividend UNVR.JK", "sell UNVR.JK", "buy UNVR.JK",
    ]);
    const net = Object.fromEntries(res.entries.map((e) => [`${e.type} ${e.symbol}`, e.net]));
    expect(net).toMatchObject({ "buy UNVR.JK": "200500", "sell UNVR.JK": "99900", "dividend UNVR.JK": "3000", "fee UNVR.JK": "300", "buy NVDA": "201" });
  });

  it("converts at the trade's own rate and totals what's left after filtering", async () => {
    const res = await logRead((db) => getTradeLog(db));
    expect(res.entries.find((e) => e.symbol === "NVDA")?.net_idr).toBe("3216000");
    expect(res.totals).toEqual({ bought_idr: "3416500", sold_idr: "99900", dividends_idr: "3000" });

    const sells = await logRead((db) => getTradeLog(db, { side: "sell" }));
    expect(sells.entries).toHaveLength(1);
    expect(sells.totals).toEqual({ bought_idr: "0", sold_idr: "99900", dividends_idr: "0" });
    expect(sells.symbols).toEqual(["ADRO.JK", "NVDA", "UNVR.JK"]);
  });

  it("filters by side and asset, and ignores an unknown side", async () => {
    const other = await logRead((db) => getTradeLog(db, { side: "other" }));
    expect(other.entries.map((e) => e.type)).toEqual(["deposit", "fee"]);
    const one = await logRead((db) => getTradeLog(db, { side: "buy", symbol: "NVDA" }));
    expect(one.entries).toHaveLength(1);
    const odd = await logRead((db) => getTradeLog(db, { side: "nonsense" }));
    expect(odd.side).toBe("all");
    expect(odd.entries).toHaveLength(6);
  });

  it("shows nothing from another account", async () => {
    const res = await withUser(other.id, (db) => getTradeLog(db), { readOnly: true });
    expect(res.entries.some((e) => e.symbol === "UNVR.JK")).toBe(false);
  });
});

describe("ignoring position alerts", () => {
  let client: Client;
  let owner: User;
  const write = <T>(fn: (db: Parameters<Parameters<typeof withUser>[1]>[0]) => Promise<T>) => withUser(owner.id, fn);
  const position = async (symbol: string) => {
    const { positions } = await write((db) => getPositions(db));
    return positions.find((p) => p.symbol === symbol);
  };

  beforeAll(async () => {
    owner = await createUser(getPool(), { email: "ignore@example.com", name: "Ignore", password: "correct horse" });
    client = await connect(owner.id);
    await call(client, "log_trade", { symbol: "BBRI.JK", type: "buy", qty: 100, price: 4000 });
    await call(client, "set_price", { symbol: "BBRI.JK", price: 3900 });
  });

  afterAll(async () => {
    await client.close();
    await deleteUser(getPool(), owner.id);
  });

  it("hides the alert, for the dashboard and for check_alerts, until restored", async () => {
    expect(await position("BBRI.JK")).toMatchObject({ state: "missing", ignored: false });
    await write((db) => ignoreAlert(db, "BBRI.JK"));
    expect(await position("BBRI.JK")).toMatchObject({ state: "missing", ignored: true });
    expect((await call(client, "check_alerts")).positions_without_thesis).toEqual([]);

    await write((db) => restoreAlert(db, "BBRI.JK"));
    expect(await position("BBRI.JK")).toMatchObject({ ignored: false });
    expect((await call(client, "check_alerts")).positions_without_thesis).toEqual(["BBRI.JK"]);
  });

  it("shows a different alert on the same asset, and a new level of the same one", async () => {
    await write((db) => ignoreAlert(db, "BBRI.JK"));
    await call(client, "save_thesis", { symbol: "BBRI.JK", title: "Recovery", why: "", kill_criteria: "NPL", horizon: "1y", conviction: 3, kill_price: 4000 });
    expect(await position("BBRI.JK")).toMatchObject({ state: "alert", reason: "kill", ignored: false });

    await write((db) => ignoreAlert(db, "BBRI.JK"));
    expect(await position("BBRI.JK")).toMatchObject({ ignored: true });
    await getPool().query("update theses set kill_price = 3950 where user_id = $1", [owner.id]);
    expect(await position("BBRI.JK")).toMatchObject({ state: "alert", ignored: false });
  });

  it("refuses when there's nothing to ignore, and stays in its own account", async () => {
    await expect(write((db) => ignoreAlert(db, "TLKM.JK"))).rejects.toThrow("no alert to ignore");
    await withUser(other.id, (db) => restoreAlert(db, "BBRI.JK"));
    await write((db) => ignoreAlert(db, "BBRI.JK"));
    await withUser(other.id, (db) => restoreAlert(db, "BBRI.JK"));
    expect(await position("BBRI.JK")).toMatchObject({ ignored: true });
  });
});

describe("asset price chart", () => {
  it("fetches history for an asset that's only on the watchlist, once, keeping stored prices", async () => {
    const watcher = await createUser(getPool(), { email: "chart@example.com", name: "Chart", password: "correct horse" });
    const client = await connect(watcher.id);
    const d = (n: number) => addDays(day, -n);
    history = { META: [[d(400), 500], [d(30), 600], [d(1), 700], [day, 999]] };
    await call(client, "add_to_watchlist", { symbol: "META", asset_class: "us_stock", zone_low: 100, zone_high: 200, reason: "Waiting" });
    await withUser(watcher.id, async (db) => {
      const { rows } = await db.query("select * from assets where symbol = 'META'");
      await savePrice(db, rows[0], day, new Decimal(710), "test");
    });

    const read1 = () => withUser(watcher.id, (db) => getPriceChart(db, "META"), { readOnly: true });
    expect((await read1()).needs_history).toBe(true);

    await withUser(watcher.id, (db) => fillAssetHistory(db, "META"));
    const after = await read1();
    expect(after.needs_history).toBe(false);
    expect(after.points.map((p) => p.close)).toEqual([500, 600, 700, 710]);
    expect(after.points[0]?.date).toBe(d(400));

    await client.close();
    await deleteUser(getPool(), watcher.id);
    history = {};
  });

  it("never asks a feed for a manual asset, and reports a failed fetch without marking it done", async () => {
    const owner = await createUser(getPool(), { email: "chart2@example.com", name: "Chart", password: "correct horse" });
    await withUser(owner.id, (db) => db.query("insert into assets (symbol, name, class, currency, price_source) values ('HOUSE','House','other','IDR','manual'), ('AAPL','Apple','us_stock','USD','yahoo')"));
    expect((await withUser(owner.id, (db) => getPriceChart(db, "HOUSE"))).needs_history).toBe(false);

    const real = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    await expect(withUser(owner.id, (db) => fillAssetHistory(db, "AAPL"))).rejects.toThrow("Couldn't fetch AAPL's price history");
    vi.stubGlobal("fetch", real);
    expect((await withUser(owner.id, (db) => getPriceChart(db, "AAPL"))).needs_history).toBe(true);
    await deleteUser(getPool(), owner.id);
  });
});

describe("macro view detail", () => {
  it("lists linked stocks, held or followed, with each one's share of the exposure", async () => {
    const owner = await createUser(getPool(), { email: "view@example.com", name: "View", password: "correct horse" });
    const client = await connect(owner.id);
    await call(client, "log_trade", { symbol: "BBRI.JK", type: "buy", qty: 100, price: 4000 });
    await call(client, "log_trade", { symbol: "BBCA.JK", type: "buy", qty: 100, price: 8000 });
    await call(client, "set_price", { symbol: "BBRI.JK", price: 3000 });
    await call(client, "set_price", { symbol: "BBCA.JK", price: 9000 });
    await call(client, "add_to_watchlist", { symbol: "BMRI.JK", zone_low: 4000, zone_high: 4500, reason: "Cheap" });
    const view = await call(client, "save_macro_view", { short_name: "Rate cuts", area: "Indonesia", conviction: "Medium", view: "Cuts lift banks", wrong_if: "No cuts", symbols: ["BBRI.JK"] });
    const w = (fn: Parameters<typeof withUser>[1]) => withUser(owner.id, fn);

    await w((db) => linkMacroAsset(db, view.id, "BBCA.JK"));
    await w((db) => linkMacroAsset(db, view.id, "BBCA.JK"));
    await w((db) => linkMacroAsset(db, view.id, "BMRI.JK"));
    const detail = await withUser(owner.id, (db) => getMacroView(db, view.id), { readOnly: true });
    expect(detail.assets.map((a) => [a.symbol, a.position ? "held" : "followed", a.share_pct])).toEqual([
      ["BBCA.JK", "held", "75.00"],
      ["BBRI.JK", "held", "25.00"],
      ["BMRI.JK", "followed", null],
    ]);
    expect(detail.exposure_idr).toBe("1200000.00");
    expect(detail.assets.find((a) => a.symbol === "BMRI.JK")?.watch).toMatchObject({ zone_low: "4000" });

    await w((db) => unlinkMacroAsset(db, view.id, "BBRI.JK"));
    expect((await w((db) => getMacroView(db, view.id))).assets.map((a) => a.symbol)).toEqual(["BBCA.JK", "BMRI.JK"]);

    await expect(w((db) => linkMacroAsset(db, view.id, "NOPE"))).rejects.toThrow("Don't know what NOPE is");
    await expect(w((db) => linkMacroAsset(db, view.id, "USDIDR"))).rejects.toThrow("shared exchange rate");

    // A ticker that isn't held, or even known yet, can still be linked.
    await w((db) => linkMacroAsset(db, view.id, "nvda", "us_stock"));
    const withNvda = await w((db) => getMacroView(db, view.id));
    expect(withNvda.assets.find((a) => a.symbol === "NVDA")).toMatchObject({ class: "us_stock", currency: "USD", position: null, share_pct: null });
    expect(withNvda.exposure_idr).toBe("900000.00");

    const viaTool = await call(client, "save_macro_view", { id: view.id, symbols: ["BBCA.JK", "TSM", "ANTM"], asset_classes: { TSM: "us_stock", ANTM: "idx_stock" } });
    expect(viaTool.symbols).toEqual(["BBCA.JK"]);
    expect((await w((db) => getMacroView(db, view.id))).assets.map((a) => a.symbol)).toEqual(["BBCA.JK", "ANTM.JK", "TSM"]);
    await expect(call(client, "save_macro_view", { id: view.id, symbols: ["AVGO"] })).rejects.toThrow(/Don't know what AVGO is/);
    const asText = await call(client, "save_macro_view", { id: view.id, symbols: ["BBCA.JK", "AVGO"], asset_classes: '{"AVGO": "us_stock"}' });
    expect(asText.id).toBe(view.id);
    expect((await w((db) => getMacroView(db, view.id))).assets.map((a) => a.symbol)).toEqual(["BBCA.JK", "AVGO"]);
    await expect(withUser(other.id, (db) => getMacroView(db, view.id))).rejects.toThrow(`No macro view ${view.id}`);
    await expect(withUser(other.id, (db) => linkMacroAsset(db, view.id, "BBCA.JK"))).rejects.toThrow("No macro view");
    await expect(withUser(other.id, (db) => unlinkMacroAsset(db, view.id, "BBCA.JK"))).rejects.toThrow("No macro view");

    await client.close();
    await deleteUser(getPool(), owner.id);
  });
});
