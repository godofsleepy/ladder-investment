import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkAlerts } from "./alerts.js";
import type { Identity } from "./auth.js";
import { updateAsset } from "./assets.js";
import { getAssetDetail } from "./detail.js";
import { today, assertDate } from "./dates.js";
import { withUser, type Db, type Tx } from "./db.js";
import { addNote, searchNotes } from "./journal.js";
import { deleteMacroView, getMacroViews, saveMacroView } from "./macro.js";
import { LadderError, parseAmount } from "./money.js";
import { getAllocation, getNetWorth, getPortfolio } from "./portfolio.js";
import { ensurePrice, refreshPrices, setPrice } from "./prices/refresh.js";
import { closeThesis, getScorecard, getTheses, reviewThesis, saveThesis } from "./thesis.js";
import { deleteTrade, importTrades, logTrade, settleTrade } from "./trades.js";
import { addToWatchlist, getWatchlist, readItem, updateWatchlistItem } from "./watchlist.js";

const amount = z.union([z.number(), z.string()]);
const money = (d: string) => amount.describe(`${d}. A number, or shorthand like "1.1B", "750k"`);
const symbol = z.string().describe('Ticker: BTC, BBRI.JK, AAPL, XAU. Gold is XAU and is counted in grams');
const assetClass = z.enum(["crypto", "us_stock", "idx_stock", "gold", "bond", "other"]);
const newAsset = {
  asset_class: assetClass.optional().describe("Needed the first time Ladder sees a symbol it can't infer"),
  name: z.string().optional(),
  currency: z.enum(["IDR", "USD"]).optional().describe('Only for asset_class "other"'),
  source_id: z.string().optional().describe("CoinGecko id for a coin Ladder doesn't know"),
};
const priority = z.enum(["high", "medium", "low"]);
const horizon = z.enum(["3m", "6m", "1y", "3y", "5y+"]);
const conviction = z.number().int().min(1).max(5);
const reviewEvery = z.enum(["monthly", "quarterly", "half-yearly"]);
const date = z.string().describe("YYYY-MM-DD");

export const WEEKLY_REVIEW_PROMPT = `Run my weekly Ladder review.

1. Call refresh_prices, then check_alerts.
2. For each thesis needing review, one at a time: show its title, why, what triggered the review and its return since opened. Ask: still valid, update, or close.
3. Save my answer with review_thesis or close_thesis, and always include my reasoning as the note. Notes are saved to the journal.
4. Then list watchlist items in their zone and positions with no thesis, and ask if I want to act on any.
5. If nothing needs attention, say so in one line and stop.

Never calculate money yourself: every number comes from a Ladder tool.`;

function reply(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return reply(await fn());
  } catch (err) {
    const message = err instanceof LadderError ? err.message : `Ladder failed: ${err instanceof Error ? err.message : err}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

export function createServer({ userId, access }: Identity): McpServer {
  const server = new McpServer(
    { name: "ladder", version: "0.1.0" },
    {
      instructions:
        "Ladder holds the user's investments, theses and notes, and does all the maths. Never calculate money yourself: every number you report must come from a Ladder tool. When a tool returns prompts, act on them with the user.",
    },
  );
  const tx: Tx = (fn) => withUser(userId, fn);
  const read = <T>(fn: (db: Db) => Promise<T>) => withUser(userId, fn, { readOnly: true });
  /** Read-only access never even lists a write tool. */
  const write = (tool: RegisteredTool) => {
    if (access !== "rw") tool.remove();
  };

  write(server.registerTool(
    "log_trade",
    {
      description:
        "Record a buy, sell, dividend, fee or deposit. buy and sell need qty and price per unit. dividend is qty x price per share. fee is a standalone charge passed in fee. deposit brings in holdings bought elsewhere at cost price. Marks a matching watchlist item bought and activates a draft thesis. Follow the returned prompts.",
      inputSchema: {
        symbol,
        type: z.enum(["buy", "sell", "dividend", "fee", "deposit"]),
        qty: money("Units").optional(),
        price: money("Price per unit, in the trade currency").optional(),
        fee: money("Fee as an amount").optional(),
        fee_pct: money("Fee as a percent of qty x price, e.g. 0.3").optional(),
        platform: z.string().optional().describe("Indodax, Stockbit, Bibit, Gotrade, Pluang..."),
        date: date.optional().describe("YYYY-MM-DD, defaults to today"),
        trade_currency: z.enum(["IDR", "USD"]).optional().describe("Defaults to the asset's currency"),
        fx_rate: money("USD/IDR actually paid, for USD trades. Looked up if left out").optional(),
        note: z.string().optional(),
        ...newAsset,
      },
    },
    (input) => run(async () => {
      const result = await logTrade(tx, input);
      await settleTrade(tx, result.trade.symbol);
      return result;
    }),
  ));

  write(server.registerTool(
    "import_trades",
    {
      description:
        "Import trades from CSV text. Header row with symbol,type,qty,price,date and optionally fee,fee_pct,platform,currency,fx_rate,asset_class,note. Rows already imported are skipped.",
      inputSchema: {
        csv: z.string(),
        platform: z.string().optional().describe("Used for rows with no platform column"),
      },
    },
    ({ csv, platform }) => run(() => importTrades(tx, csv, platform)),
  ));

  write(server.registerTool(
    "delete_trade",
    {
      description: "Delete a mistaken trade by id (ids come from get_asset_detail). Refused if a later sell depends on it. Confirm with the user first.",
      inputSchema: { trade_id: z.number().int() },
    },
    ({ trade_id }) => run(() => deleteTrade(tx, trade_id)),
  ));

  server.registerTool(
    "get_portfolio",
    {
      description: "Holdings with value in IDR, cost, and P&L per asset and in total. Read warnings: unpriced assets are left out of totals.",
      inputSchema: { as_of: date.optional().describe("YYYY-MM-DD, defaults to today") },
    },
    ({ as_of }) => run(() => read((db) => getPortfolio(db, as_of ? assertDate(as_of, "as_of") : today()))),
  );

  server.registerTool(
    "get_allocation",
    {
      description: "Percent and IDR value per group.",
      inputSchema: { group_by: z.enum(["class", "platform", "currency"]) },
    },
    ({ group_by }) => run(() => read((db) => getAllocation(db, group_by))),
  );

  server.registerTool(
    "get_asset_detail",
    {
      description: "Everything on one asset: position, trades with ids, theses, watchlist zone, review history, recent notes.",
      inputSchema: { symbol },
    },
    ({ symbol: s }) => run(() => read((db) => getAssetDetail(db, s))),
  );

  write(server.registerTool(
    "add_to_watchlist",
    {
      description: "Add an asset to buy at a price. zone_low and zone_high are in the asset's currency; gold is IDR per gram. For one price, leave out zone_high.",
      inputSchema: {
        symbol,
        zone_low: money("Bottom of the buy zone"),
        zone_high: money("Top of the buy zone").optional(),
        reason: z.string().describe("One line, max 140 characters"),
        priority: priority.optional(),
        planned_amount: money("IDR planned to deploy").optional(),
        alert: z.boolean().optional(),
        ...newAsset,
      },
    },
    (input) =>
      run(async () => {
        const { assetId, itemId } = await tx((db) => addToWatchlist(db, input));
        const priceNote = await tx((db) => ensurePrice(db, assetId)).then(
          () => undefined,
          () => "Could not fetch a price yet. refresh_prices or set_price will fill it in.",
        );
        return { item: await tx((db) => readItem(db, itemId)), ...(priceNote ? { note: priceNote } : {}) };
      }),
  ));

  server.registerTool(
    "get_watchlist",
    {
      description: "Watchlist items with price, zone, distance and status, triggered first then closest to zone.",
      inputSchema: {
        status: z.enum(["active", "history", "watching", "triggered", "bought", "dropped"]).optional().describe("Defaults to active"),
        class: assetClass.optional(),
        priority: priority.optional(),
      },
    },
    (input) => run(() => read((db) => getWatchlist(db, input))),
  );

  write(server.registerTool(
    "update_watchlist_item",
    {
      description: 'Change an item, or set status "dropped" with a drop_reason.',
      inputSchema: {
        item_id: z.number().int(),
        zone_low: money("Bottom of the buy zone").optional(),
        zone_high: money("Top of the buy zone").optional(),
        reason: z.string().optional(),
        priority: priority.optional(),
        planned_amount: money("IDR planned to deploy").optional(),
        alert: z.boolean().optional(),
        status: z.literal("dropped").optional(),
        drop_reason: z.string().optional(),
      },
    },
    ({ item_id, ...changes }) => run(() => tx((db) => updateWatchlistItem(db, item_id, changes))),
  ));

  write(server.registerTool(
    "save_thesis",
    {
      description:
        "Write the thesis for an asset. Saved as active if it is owned, otherwise as a draft that activates on the first buy. Saving again overwrites a draft. An active thesis changes through review_thesis.",
      inputSchema: {
        symbol,
        title: z.string().describe("One sentence you could say out loud, max 200 characters"),
        why: z.string().describe("The reasoning behind it"),
        kill_criteria: z.string().describe("The fact that would prove this wrong"),
        horizon,
        conviction: conviction.describe("1 to 5"),
        target_price: money("Take-profit price").optional(),
        kill_price: money("Price version of the kill criteria").optional(),
        next_review: date.optional().describe("YYYY-MM-DD, defaults to one review period from today"),
        add_rule: z.string().optional().describe('When to add, e.g. "Below $150"'),
        trim_rule: z.string().optional().describe('When to trim, e.g. "Above $230"'),
        max_weight_pct: money("Largest share of the portfolio this may be, in percent").optional(),
        review_every: reviewEvery.optional(),
        ...newAsset,
      },
    },
    (input) => run(() => tx((db) => saveThesis(db, input))),
  ));

  server.registerTool(
    "get_theses",
    {
      description: "List theses with return, distance to target and kill price, and review flags.",
      inputSchema: {
        status: z.enum(["draft", "active", "achieved", "invalidated", "closed", "needs_review"]).optional(),
        symbol: symbol.optional(),
      },
    },
    (input) => run(() => read((db) => getTheses(db, input))),
  );

  write(server.registerTool(
    "review_thesis",
    {
      description:
        "Save a review of an active thesis. Pass changes to update fields; the old version is kept in the review history. A price trigger answered here stays quiet until the next review date.",
      inputSchema: {
        thesis_id: z.number().int(),
        still_valid: z.boolean(),
        note: z.string().optional(),
        next_review: date.optional().describe("YYYY-MM-DD, defaults to 3 months from today"),
        changes: z
          .object({
            title: z.string().optional(),
            why: z.string().optional(),
            kill_criteria: z.string().optional(),
            horizon: horizon.optional(),
            conviction: conviction.optional(),
            target_price: money("Take-profit price").optional(),
            kill_price: money("Kill price").optional(),
            add_rule: z.string().optional(),
            trim_rule: z.string().optional(),
            max_weight_pct: money("Largest share of the portfolio, in percent").optional(),
            review_every: reviewEvery.optional(),
          })
          .optional(),
      },
    },
    (input) => run(() => tx((db) => reviewThesis(db, input))),
  ));

  write(server.registerTool(
    "close_thesis",
    {
      description: "Close an active thesis. status: achieved (target reached), invalidated (kill criteria hit), closed (sold for another reason).",
      inputSchema: {
        thesis_id: z.number().int(),
        status: z.enum(["achieved", "invalidated", "closed"]),
        outcome: z.enum(["right", "wrong", "mixed"]),
        note: z.string().optional(),
      },
    },
    (input) => run(() => tx((db) => closeThesis(db, input))),
  ));

  server.registerTool(
    "check_alerts",
    {
      description: "What needs attention: theses to review, watchlist items in their zone, positions with no thesis, stale or missing prices.",
      inputSchema: {},
    },
    () => run(() => read((db) => checkAlerts(db))),
  );

  write(server.registerTool(
    "add_note",
    {
      description: "Save a dated journal note, optionally linked to an asset or thesis.",
      inputSchema: {
        body: z.string(),
        symbol: symbol.optional(),
        thesis_id: z.number().int().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    (input) => run(() => tx((db) => addNote(db, { ...input, author: "Assistant" }))),
  ));

  server.registerTool(
    "search_notes",
    {
      description: "Keyword search over notes and theses, newest first. Every word must appear. Leave text empty to list recent notes.",
      inputSchema: {
        text: z.string().optional(),
        symbol: symbol.optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    (input) => run(() => read((db) => searchNotes(db, input))),
  );

  write(server.registerTool(
    "refresh_prices",
    {
      description: "Fetch today's prices for all assets. Lists failures and any watchlist items that entered their zone.",
      inputSchema: {},
    },
    () => run(() => tx((db) => refreshPrices(db))),
  ));

  write(server.registerTool(
    "set_price",
    {
      description: "Enter a price by hand, in the asset's currency (gold is IDR per gram). Use when a feed is wrong or missing.",
      inputSchema: {
        symbol,
        price: money("Price per unit"),
        date: date.optional().describe("YYYY-MM-DD, defaults to today"),
      },
    },
    ({ symbol: s, price, date: d }) =>
      run(() => tx((db) => setPrice(db, s, price, d ? assertDate(d) : undefined))),
  ));

  write(server.registerTool(
    "update_asset",
    {
      description: 'Rename an asset or change where its price comes from. Set price_source to "manual" to keep your own prices, for example Antam buyback for gold.',
      inputSchema: {
        symbol,
        name: z.string().optional(),
        price_source: z.enum(["coingecko", "yahoo", "xau", "manual"]).optional(),
        source_id: z.string().optional(),
      },
    },
    ({ symbol: s, ...changes }) => run(() => tx((db) => updateAsset(db, s, changes))),
  ));

  server.registerTool(
    "get_macro_views",
    {
      description: "Macro views: beliefs about the world that holdings ride on, with signals, exposure and review state. Weakening and broken views come first.",
      inputSchema: {},
    },
    () => run(() => read((db) => getMacroViews(db))),
  );

  write(server.registerTool(
    "save_macro_view",
    {
      description:
        'Add a macro view, or update one by passing id. Adding needs short_name, area, conviction, view and wrong_if; an update changes only the fields you pass and keeps the rest. Example: short_name "Weak rupiah", area "Currency", view "The rupiah keeps losing ground through 2027". status is holding, weak or broken; a view past its review date shows as review due by itself. symbols lists the holdings riding on it and replaces the old list when given; leave it out to keep the links. signals also replaces the whole list when given.',
      inputSchema: {
        id: z.number().int().optional().describe("Leave out to add a new view"),
        short_name: z.string().max(24).optional().describe("A short label for the Holdings table. Required when adding"),
        area: z.string().max(40).optional().describe("Currency, Technology, Indonesia, Global... Required when adding"),
        conviction: z.enum(["High", "Medium", "Low"]).optional().describe("Required when adding"),
        status: z.enum(["holding", "weak", "broken"]).optional(),
        view: z.string().optional().describe("The belief, in one sentence. Required when adding"),
        why: z.string().optional(),
        wrong_if: z.string().optional().describe("What would prove this view wrong. Required when adding"),
        signals: z
          .array(z.object({ kind: z.enum(["for", "against", "watch"]), text: z.string() }))
          .optional()
          .describe("Evidence for or against it, and things to watch"),
        symbols: z.array(symbol).optional().describe("Holdings riding on this view"),
        next_review: date.optional().describe("YYYY-MM-DD. A new view defaults to 3 months from today; an update keeps its date"),
      },
    },
    (input) => run(() => tx((db) => saveMacroView(db, input))),
  ));

  write(server.registerTool(
    "delete_macro_view",
    {
      description: "Delete a macro view by id. Confirm with the user first.",
      inputSchema: { id: z.number().int() },
    },
    ({ id }) => run(() => tx((db) => deleteMacroView(db, id))),
  ));

  server.registerTool(
    "get_scorecard",
    {
      description: "Hit rate of closed theses, overall, by asset class and by conviction. Mixed outcomes are counted but not scored.",
      inputSchema: {},
    },
    () => run(() => read((db) => getScorecard(db))),
  );

  server.registerTool(
    "get_net_worth",
    {
      description: "Net worth in IDR: Guardian cash plus Ladder assets. Get the cash figure from Guardian Finance first and pass it unchanged.",
      inputSchema: { guardian_cash_idr: money("Cash total reported by Guardian Finance") },
    },
    ({ guardian_cash_idr }) =>
      run(() => read((db) => getNetWorth(db, parseAmount(guardian_cash_idr, "guardian_cash_idr")))),
  );

  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly thesis review",
      description: "Walk through every thesis and idea that needs attention this week.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: WEEKLY_REVIEW_PROMPT },
        },
      ],
    }),
  );

  return server;
}
