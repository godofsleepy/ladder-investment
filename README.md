# Ladder

A personal second brain for investing. Ladder stores trades, prices, theses and notes and does all the maths. An AI agent is the brain and connects over MCP. No model or API key lives inside Ladder.

## Setup

Needs Node 22+ and Docker.

```bash
cp .env.example .env        # then set a password in both lines
docker compose up -d --wait
npm install
npm run build
npm run migrate
```

Postgres listens on `127.0.0.1:54329`. To move hosts later, change `DATABASE_URL`.

## Connect an agent

`.mcp.json` registers Ladder for Claude Code when it runs in this folder. For any other MCP client, run `node dist/server.js` over stdio. Pending migrations apply on start.

## Daily prices

```bash
npm run refresh-prices
```

Exits non-zero if any feed failed. To run it daily at 18:00, add this with `crontab -e`:

```
0 18 * * * cd /path/to/ladder && npm run -s refresh-prices >> refresh.log 2>&1
```

## How the numbers work

- **Average cost:** moving weighted average. Buy fees add to cost; sell fees reduce proceeds.
- **IDR cost:** USD trades lock the USD/IDR rate of the trade date, so P&L includes currency moves. Pass `fx_rate` to use the rate you actually paid.
- **Realized P&L:** sale gains plus dividends, less standalone fees.
- **Same-day order:** buys are applied before sells.
- **Trade types:** `deposit` brings in holdings at cost, which suits entering existing positions. `dividend` is qty × per-share amount. `fee` passes its amount in `fee`.
- **Gold:** symbol `XAU`, counted in grams, priced in IDR per gram. Yahoo has no spot symbol, so it uses `GC=F` gold futures × USD/IDR, which reads slightly above spot. For Antam buyback, use `update_asset` with `price_source: "manual"`, then `set_price`.
- **Missing prices:** the last price is kept and flagged stale after 4 days. An asset with no price is left out of totals and listed in `warnings`.
- **Reviewed price triggers:** a kill or target hit answered in `review_thesis` stays quiet until the next review date, unless the level is changed.

## CSV import

`import_trades` takes a header row with `symbol,type,qty,price,date` and optionally `fee,fee_pct,platform,currency,fx_rate,asset_class,note`. Rows are applied oldest first. Bad rows and duplicates are skipped and reported. Platform-specific export formats aren't supported yet.

## Tests

```bash
npm test
```

Tests recreate a separate `ladder_test` database on the same server and use fake price feeds.

## Dashboard

Screens in `dashboard/`, built from the Ladder design canvas (the "without ACP" board), with the direction in `DESIGN.md`.

```bash
cd dashboard
npm install
npm run build
npm start
```

It opens at http://127.0.0.1:3100. Create your account there first: the first account also inherits anything logged before accounts existed.

Pages read in a transaction Postgres won't let write. Changes go through forms that call the same logic as the MCP tools: Log trade, Add note, the thesis form, Mark reviewed and Refresh prices. Everything else goes through your agent, including adding watchlist ideas and macro views.

- **Growth** uses real daily closes, fetched back to your first trade when you log a trade or refresh prices. Manual assets, like bonds, use the prices you set.
- **Theses** shows macro views, which your agent manages with `save_macro_view`. The thesis for one holding lives on its asset page.
- **The trade preview** runs Ladder's own engine, so it can't disagree with what gets recorded.

## Accounts

Each account sees only its own portfolio. This is enforced by Postgres row-level security, not just by the code: tool queries run as the `ladder_app` role, scoped to one account, and that role can't read passwords or tokens at all. Passwords are hashed with scrypt, and sessions and tokens are stored only as hashes.

Optional settings are listed in `.env.example`:

| Setting | What it turns on |
|---|---|
| `LADDER_ALLOWED_EMAILS` | Limits who can create an account |
| `SMTP_URL`, `EMAIL_FROM` | Password reset emails and notifications, sent by `npm run refresh-prices` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The "Continue with Google" button |

Without email, reset a password on the server with `npm run reset-password you@example.com`, then open the link it prints on your dashboard's address.

## Connecting assistants

The Account page shows your MCP server URL, which is your dashboard's address plus `/mcp`.

- **Claude Code:** `claude mcp add --transport http ladder <your URL>`, then sign in when the browser opens.
- **Other clients:** create an access token on the Account page and send it as `Authorization: Bearer <token>`.
- **Claude on the web or phone:** these connect from the internet, so they need a public address. They can't reach a tailnet-only one.
- **Local stdio:** `.mcp.json` runs `node dist/server.js`. It uses your account if there's only one, otherwise set `LADDER_TOKEN`.

"What assistants can do" on the Account page is enforced by the server: read only removes every write tool, and applies to connections you already have.

## Screens that moved

The canvas has no separate Review, watchlist item or thesis detail pages. Reviews happen on the asset page or through the `weekly_review` prompt, and `get_theses` and `get_scorecard` still cover closed theses and your hit rate.

## Weekly review

The server offers a `weekly_review` MCP prompt, or tell your agent "Run my weekly Ladder review". Review notes are saved to the journal as well as to the thesis history.

## Net worth

Guardian Finance stays a separate connector. Ask your agent for net worth: it reads the cash figure from Guardian and passes it to `get_net_worth`, which does the addition.

## Not built

Semantic search was left out on purpose, because it needs an embedding model and Ladder holds none. `search_notes` is keyword search, and the embedding columns stay empty.

## Opening the dashboard over Tailscale

`tailscale serve --bg --https=3443 http://127.0.0.1:3100` publishes it to your tailnet at `https://<your-machine>.<your-tailnet>.ts.net:3443`. To turn it off, run `tailscale serve --https=3443 off`.

Everything on the tailnet can reach the sign-in page, and anyone who reaches it can create an account unless `LADDER_ALLOWED_EMAILS` is set. Set that before ever using `tailscale funnel`, which makes it public.
