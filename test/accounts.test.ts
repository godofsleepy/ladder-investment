import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createApiToken,
  createPasswordReset,
  createSession,
  createUser,
  deleteUser,
  endSession,
  googleUser,
  hashPassword,
  listConnections,
  localIdentity,
  mayJoin,
  resetPassword,
  revokeConnection,
  safeNext,
  sessionUser,
  signIn,
  tokenIdentity,
  updatePreferences,
  verifyPassword,
  type Identity,
  type User,
} from "../src/auth.js";
import { addDays, today } from "../src/dates.js";
import { closePool, getPool, withUser } from "../src/db.js";
import { exportAccount } from "../src/export.js";
import { migrate } from "../src/migrate.js";
import { LadderError } from "../src/money.js";
import { sendDueEmails } from "../src/notify.js";
import { createAuthCode, exchangeCode, OAuthError, refreshGrant, registerClient, validateAuthorize } from "../src/oauth.js";
import { READ_TOOLS, WRITE_TOOLS } from "../src/tool-names.js";
import { createServer } from "../src/tools.js";

const db = () => getPool();
const PASSWORD = "correct horse";

async function connect(identity: Identity) {
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(identity).connect(a);
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

let alice: User;
let bob: User;
let aliceMcp: Client;
let bobMcp: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ chart: { result: null, error: { description: "offline" } } })));
  await migrate();
  // Left over from before accounts existed: the first person to join should inherit it.
  await db().query(
    "insert into assets (symbol, name, class, currency, price_source) values ('OLD.JK', 'Old', 'idx_stock', 'IDR', 'manual')",
  );
  alice = await createUser(db(), { email: "alice@example.com", name: "Alice", password: PASSWORD });
  bob = await createUser(db(), { email: "bob@example.com", name: "Bob", password: PASSWORD });
  aliceMcp = await connect({ userId: alice.id, access: "rw" });
  bobMcp = await connect({ userId: bob.id, access: "rw" });
});

afterAll(async () => {
  await aliceMcp.close();
  await bobMcp.close();
  await closePool();
  vi.unstubAllGlobals();
});

describe("passwords and sessions", () => {
  it("hashes passwords and never stores them", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });

  it("signs in with the right password only, ignoring email case", async () => {
    expect((await signIn(db(), "ALICE@example.com", PASSWORD))?.id).toBe(alice.id);
    expect(await signIn(db(), "alice@example.com", "wrong horse")).toBeNull();
    expect(await signIn(db(), "nobody@example.com", PASSWORD)).toBeNull();
  });

  it("refuses duplicates, short passwords and bad addresses", async () => {
    await expect(createUser(db(), { email: "Alice@Example.com", name: "A", password: PASSWORD })).rejects.toThrow(/already exists/);
    await expect(createUser(db(), { email: "c@example.com", name: "C", password: "short" })).rejects.toThrow(/at least 8/);
    await expect(createUser(db(), { email: "not-an-email", name: "C", password: PASSWORD })).rejects.toThrow(/valid email/);
  });

  it("keeps only a hash of the session token and ends it on sign-out", async () => {
    const { token } = await createSession(db(), alice.id);
    const stored = await db().query("select token_hash from sessions");
    expect(stored.rows.map((r) => r.token_hash)).not.toContain(token);
    expect((await sessionUser(db(), token))?.email).toBe("alice@example.com");
    await endSession(db(), token);
    expect(await sessionUser(db(), token)).toBeNull();
    expect(await sessionUser(db(), "made-up")).toBeNull();
  });

  it("rejects an expired session", async () => {
    const { token } = await createSession(db(), alice.id);
    await db().query("update sessions set expires_at = now() - interval '1 minute'");
    expect(await sessionUser(db(), token)).toBeNull();
  });

  it("resets a password once and signs out every device", async () => {
    const user = await createUser(db(), { email: "reset@example.com", name: "R", password: PASSWORD });
    const { token: session } = await createSession(db(), user.id);
    const reset = await createPasswordReset(db(), "reset@example.com");
    await resetPassword(db(), reset?.token as string, "a brand new password");
    expect(await signIn(db(), "reset@example.com", PASSWORD)).toBeNull();
    expect((await signIn(db(), "reset@example.com", "a brand new password"))?.id).toBe(user.id);
    expect(await sessionUser(db(), session)).toBeNull();
    await expect(resetPassword(db(), reset?.token as string, "another password")).rejects.toThrow(/expired or was already used/);
    expect(await createPasswordReset(db(), "nobody@example.com")).toBeNull();
    await deleteUser(db(), user.id);
  });

  it("only follows sign-in redirects on this site", () => {
    expect(safeNext("/theses/1?x=1")).toBe("/theses/1?x=1");
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext("/\\evil.example")).toBeNull();
    expect(safeNext("/login")).toBeNull();
  });

  it("limits who can join when an allow list is set", () => {
    expect(mayJoin("a@b.com", "")).toBe(true);
    expect(mayJoin("A@B.com", "a@b.com")).toBe(true);
    expect(mayJoin("x@family.id", "@family.id")).toBe(true);
    expect(mayJoin("x@other.id", "a@b.com,@family.id")).toBe(false);
  });

  it("links Google to a verified address, and refuses an unverified one", async () => {
    const linked = await googleUser(db(), { sub: "g-1", email: "alice@example.com", emailVerified: true, name: "Alice" });
    expect(linked.id).toBe(alice.id);
    const again = await googleUser(db(), { sub: "g-1", email: "changed@example.com", emailVerified: true, name: "Alice" });
    expect(again.id).toBe(alice.id);
    await expect(googleUser(db(), { sub: "g-2", email: "bob@example.com", emailVerified: false, name: "Bob" })).rejects.toThrow(LadderError);
    const fresh = await googleUser(db(), { sub: "g-3", email: "new@example.com", emailVerified: true, name: "New" });
    expect(fresh.has_password).toBe(false);
    expect(await signIn(db(), "new@example.com", "anything at all")).toBeNull();
    await deleteUser(db(), fresh.id);
  });
});

describe("isolation between accounts", () => {
  it("gives data from before accounts to the first person who joined", async () => {
    const { rows } = await db().query("select user_id from assets where symbol = 'OLD.JK'");
    expect(rows[0].user_id).toBe(alice.id);
    const fx = await db().query("select user_id from assets where symbol = 'USDIDR'");
    expect(fx.rows[0].user_id).toBeNull();
  });

  it("shows each account only its own portfolio, even for the same ticker", async () => {
    await call(aliceMcp, "log_trade", { symbol: "BBRI.JK", type: "buy", qty: 100, price: 4000, platform: "Stockbit" });
    await call(bobMcp, "log_trade", { symbol: "BBRI.JK", type: "buy", qty: 5, price: 3000 });
    await call(aliceMcp, "set_price", { symbol: "BBRI.JK", price: 5000 });
    await call(bobMcp, "set_price", { symbol: "BBRI.JK", price: 3100 });

    const a = await call(aliceMcp, "get_portfolio");
    const b = await call(bobMcp, "get_portfolio");
    expect(a.holdings[0]).toMatchObject({ qty: "100", value_idr: "500000.00" });
    expect(b.holdings[0]).toMatchObject({ qty: "5", value_idr: "15500.00" });
  });

  it("hides one account's records from the other's tools", async () => {
    const thesis = await call(aliceMcp, "save_thesis", {
      symbol: "BBRI.JK", title: "Alice private view", why: "secret reasoning", kill_criteria: "x", horizon: "1y", conviction: 3,
    });
    const item = (await call(aliceMcp, "add_to_watchlist", { symbol: "TLKM.JK", zone_low: 2500, reason: "alice idea" })).item;
    await call(aliceMcp, "add_note", { body: "alice secret note", tags: ["private"] });

    expect((await call(bobMcp, "search_notes", { text: "secret" })).count).toBe(0);
    expect(await call(bobMcp, "get_theses")).toEqual([]);
    expect((await call(bobMcp, "get_watchlist")).count).toBe(0);

    await expect(call(bobMcp, "review_thesis", { thesis_id: thesis.id, still_valid: false })).rejects.toThrow(/No thesis/);
    await expect(call(bobMcp, "close_thesis", { thesis_id: thesis.id, status: "closed", outcome: "wrong" })).rejects.toThrow(/No thesis/);
    await expect(call(bobMcp, "update_watchlist_item", { item_id: item.id, status: "dropped", drop_reason: "x" })).rejects.toThrow(/No watchlist item/);
    await expect(call(bobMcp, "get_asset_detail", { symbol: "TLKM.JK" })).rejects.toThrow(/No asset/);

    const { trades } = await call(aliceMcp, "get_asset_detail", { symbol: "BBRI.JK" });
    await expect(call(bobMcp, "delete_trade", { trade_id: trades[0].id })).rejects.toThrow(/No trade/);
    expect((await call(aliceMcp, "get_portfolio")).holdings[0].qty).toBe("100");
  });

  it("blocks raw queries too, so isolation doesn't depend on tool code", async () => {
    const seen = await withUser(bob.id, async (tx) => {
      const trades = await tx.query("select user_id from trades");
      const assets = await tx.query("select user_id, symbol from assets");
      return { trades: trades.rows, assets: assets.rows };
    });
    expect(seen.trades.every((t) => t.user_id === bob.id)).toBe(true);
    expect(seen.assets.every((a) => a.user_id === bob.id || a.symbol === "USDIDR")).toBe(true);

    const hit = await withUser(bob.id, (tx) => tx.query("update trades set qty = 1 where user_id = $1", [alice.id]));
    expect(hit.rowCount).toBe(0);
    await expect(withUser(bob.id, (tx) => tx.query("insert into journal (user_id, body) values ($1, 'forged')", [alice.id]))).rejects.toThrow(/row-level security/);
  });

  it("keeps the tool role away from passwords and tokens", async () => {
    for (const table of ["users", "sessions", "api_tokens", "oauth_clients", "oauth_codes", "password_resets"]) {
      await expect(withUser(bob.id, (tx) => tx.query(`select * from ${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("protects the shared exchange rate", async () => {
    await expect(call(bobMcp, "set_price", { symbol: "USDIDR", price: 1 })).rejects.toThrow(/shared exchange rate/);
    await expect(call(bobMcp, "update_asset", { symbol: "USDIDR", price_source: "manual" })).rejects.toThrow(/shared exchange rate/);
    await expect(call(bobMcp, "log_trade", { symbol: "USDIDR", type: "buy", qty: 1, price: 1 })).rejects.toThrow(/shared exchange rate/);
  });

  it("refuses writes in a read-only transaction", async () => {
    await expect(withUser(alice.id, (tx) => tx.query("update trades set qty = 1"), { readOnly: true })).rejects.toThrow(/read-only/);
  });
});

describe("assistant access", () => {
  it("lists every tool for read and write", async () => {
    const names = (await aliceMcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it("removes write tools for read-only access, and they can't be called", async () => {
    const client = await connect({ userId: alice.id, access: "ro" });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS].sort());
    expect((await call(client, "get_portfolio")).holdings[0].qty).toBe("100");
    await expect(call(client, "log_trade", { symbol: "BTC", type: "buy", qty: 1, price: 1 })).rejects.toThrow();
    await client.close();
  });

  it("issues tokens shown once, stored hashed, and revocable", async () => {
    const { id, token } = await createApiToken(db(), alice.id, "Codex");
    expect(token).toMatch(/^ldr_/);
    const stored = await db().query("select token_hash, suffix from api_tokens where id = $1", [id]);
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(await tokenIdentity(db(), token)).toEqual({ userId: alice.id, access: "rw" });

    const listed = await listConnections(db(), alice.id);
    expect(listed.find((c) => c.id === id)).toMatchObject({ name: "Codex", kind: "token", suffix: token.slice(-4) });
    expect(listed.find((c) => c.id === id)?.last_used_at).not.toBeNull();

    await revokeConnection(db(), bob.id, id);
    expect(await tokenIdentity(db(), token)).not.toBeNull();
    await revokeConnection(db(), alice.id, id);
    expect(await tokenIdentity(db(), token)).toBeNull();
    expect(await tokenIdentity(db(), "ldr_made_up")).toBeNull();
    expect(await tokenIdentity(db(), "something-else")).toBeNull();
  });

  it("applies a change of access to tokens already issued", async () => {
    const { token } = await createApiToken(db(), bob.id);
    await updatePreferences(db(), bob.id, { mcp_access: "ro" });
    expect((await tokenIdentity(db(), token))?.access).toBe("ro");
    await updatePreferences(db(), bob.id, { mcp_access: "rw" });
  });

  it("chooses the local account from a token, and refuses to guess between several", async () => {
    const { token } = await createApiToken(db(), bob.id);
    expect((await localIdentity(db(), token)).userId).toBe(bob.id);
    await expect(localIdentity(db(), "ldr_nope")).rejects.toThrow(/valid token/);
    await expect(localIdentity(db(), "")).rejects.toThrow(/several accounts/);
  });
});

describe("OAuth sign-in for assistants", () => {
  const verifier = "a-long-random-pkce-verifier-for-the-test-1234567890";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = "http://localhost:49152/callback";

  const authorize = async (clientId: string) =>
    validateAuthorize(db(), {
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    });

  it("runs the whole flow, rotates refresh tokens, and shows the connection", async () => {
    const client = await registerClient(db(), { client_name: "Claude Code", redirect_uris: [redirect] });
    const request = await authorize(client.client_id);
    expect(request.state).toBe("xyz");

    const code = await createAuthCode(db(), request, alice.id);
    const first = await exchangeCode(db(), { code, client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier });
    expect(first.token_type).toBe("Bearer");
    expect(await tokenIdentity(db(), first.access_token)).toEqual({ userId: alice.id, access: "rw" });
    expect((await listConnections(db(), alice.id)).some((c) => c.kind === "oauth" && c.name === "Claude Code")).toBe(true);

    await expect(exchangeCode(db(), { code, client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier })).rejects.toThrow(/already used/);

    const second = await refreshGrant(db(), { refresh_token: first.refresh_token, client_id: client.client_id });
    expect(await tokenIdentity(db(), first.access_token)).toBeNull();
    expect(await tokenIdentity(db(), second.access_token)).not.toBeNull();
    await expect(refreshGrant(db(), { refresh_token: first.refresh_token, client_id: client.client_id })).rejects.toThrow(/already used/);
  });

  it("rejects a wrong PKCE verifier and a code for another client", async () => {
    const client = await registerClient(db(), { client_name: "A", redirect_uris: [redirect] });
    const other = await registerClient(db(), { client_name: "B", redirect_uris: [redirect] });

    const code = await createAuthCode(db(), await authorize(client.client_id), alice.id);
    await expect(exchangeCode(db(), { code, client_id: client.client_id, redirect_uri: redirect, code_verifier: "wrong" })).rejects.toThrow(/PKCE/);

    const code2 = await createAuthCode(db(), await authorize(client.client_id), alice.id);
    await expect(exchangeCode(db(), { code: code2, client_id: other.client_id, redirect_uri: redirect, code_verifier: verifier })).rejects.toThrow(/different client/);
  });

  it("expires access tokens", async () => {
    const client = await registerClient(db(), { client_name: "Exp", redirect_uris: [redirect] });
    const code = await createAuthCode(db(), await authorize(client.client_id), alice.id);
    const { access_token: token } = await exchangeCode(db(), { code, client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier });
    await db().query("update api_tokens set expires_at = now() - interval '1 minute' where client_id = $1", [client.client_id]);
    expect(await tokenIdentity(db(), token)).toBeNull();
  });

  it("refuses unsafe registrations and unregistered redirects", async () => {
    const bad = ["http://evil.example/cb", "javascript:alert(1)", "not a url", "https://ok.example/cb#frag"];
    for (const uri of bad) {
      await expect(registerClient(db(), { redirect_uris: [uri] })).rejects.toThrow(OAuthError);
    }
    await expect(registerClient(db(), { redirect_uris: [] })).rejects.toThrow(OAuthError);

    const client = await registerClient(db(), { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    const params = { client_id: client.client_id, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" };
    await expect(validateAuthorize(db(), { ...params, redirect_uri: "https://evil.example/cb" })).rejects.toThrow(/wasn't registered/);
    await expect(validateAuthorize(db(), { ...params, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge_method: "plain" })).rejects.toThrow(/S256/);
    await expect(validateAuthorize(db(), { client_id: "nope" })).rejects.toThrow(/isn't registered/);
  });
});

describe("account data", () => {
  it("exports only this account, as a zip that real tools can open", async () => {
    const { filename, body } = await withUser(alice.id, (tx) => exportAccount(tx), { readOnly: true });
    expect(filename).toMatch(/^ladder-export-\d{4}-\d{2}-\d{2}\.zip$/);

    const file = path.join(mkdtempSync(path.join(tmpdir(), "ladder-")), "x.zip");
    writeFileSync(file, body);
    const script = `import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(",".join(sorted(z.namelist())))
print(z.read("trades.csv").decode())
print(z.read("journal.csv").decode())`;
    const out = execFileSync("python3", ["-c", script, file], { encoding: "utf8" });
    expect(out).toContain("holdings.csv,journal.csv,theses.csv,trades.csv,watchlist.csv");
    expect(out).toContain("BBRI.JK,buy,100,4000");
    expect(out).toContain("alice secret note");

    const bobs = await withUser(bob.id, (tx) => exportAccount(tx), { readOnly: true });
    expect(bobs.body.toString()).not.toContain("alice secret note");
  });

  it("emails each buy-zone hit and review once, and honours the switches", async () => {
    const carol = await createUser(db(), { email: "carol@example.com", name: "Carol", password: PASSWORD });
    const client = await connect({ userId: carol.id, access: "rw" });
    await call(client, "log_trade", { symbol: "ANTM.JK", type: "buy", qty: 1, price: 1000 });
    await call(client, "save_thesis", {
      symbol: "ANTM.JK", title: "Nickel", why: "w", kill_criteria: "k", horizon: "1y", conviction: 3, kill_price: 900,
    });
    await call(client, "add_to_watchlist", { symbol: "TINS.JK", zone_low: 900, zone_high: 1100, reason: "tin" });
    await call(client, "set_price", { symbol: "TINS.JK", price: 1000 });
    await call(client, "set_price", { symbol: "ANTM.JK", price: 800 });

    const mail: Array<{ to: string; subject: string; text: string }> = [];
    const send = async (m: { to: string; subject: string; text: string }) => void mail.push(m);
    await sendDueEmails(db(), send);
    const carols = mail.filter((m) => m.to === "carol@example.com");
    expect(carols.map((m) => m.subject).sort()).toEqual(["Review ANTM.JK: Nickel", "TINS.JK is in your buy zone"]);

    mail.length = 0;
    await sendDueEmails(db(), send);
    expect(mail.filter((m) => m.to === "carol@example.com")).toEqual([]);

    await updatePreferences(db(), carol.id, { notify_zone: false, notify_review: false });
    await call(client, "set_price", { symbol: "TINS.JK", price: 2000 });
    await call(client, "set_price", { symbol: "TINS.JK", price: 1000 });
    await sendDueEmails(db(), send);
    expect(mail.filter((m) => m.to === "carol@example.com")).toEqual([]);
    await client.close();
    await deleteUser(db(), carol.id);
  });

  it("deletes an account and every record, leaving others alone", async () => {
    const dave = await createUser(db(), { email: "dave@example.com", name: "Dave", password: PASSWORD });
    const client = await connect({ userId: dave.id, access: "rw" });
    await call(client, "log_trade", { symbol: "BMRI.JK", type: "buy", qty: 10, price: 5000 });
    await call(client, "set_price", { symbol: "BMRI.JK", price: 5500 });
    const t = await call(client, "save_thesis", { symbol: "BMRI.JK", title: "t", why: "w", kill_criteria: "k", horizon: "1y", conviction: 3 });
    await call(client, "review_thesis", { thesis_id: t.id, still_valid: true, note: "fine", next_review: addDays(today(), 30) });
    await call(client, "add_to_watchlist", { symbol: "BMRI.JK", zone_low: 4000, reason: "more", planned_amount: "1m" });
    await call(client, "add_note", { body: "dave note", symbol: "BMRI.JK" });
    await createApiToken(db(), dave.id);
    await createSession(db(), dave.id);
    await client.close();

    await deleteUser(db(), dave.id);

    for (const table of ["assets", "trades", "theses", "watchlist", "journal", "thesis_reviews", "sessions", "api_tokens"]) {
      const { rows } = await db().query(`select count(*)::int as n from ${table} where user_id = $1`, [dave.id]);
      expect(rows[0].n, table).toBe(0);
    }
    const orphans = await db().query("select count(*)::int as n from prices p left join assets a on a.id = p.asset_id where a.id is null");
    expect(orphans.rows[0].n).toBe(0);
    expect((await call(aliceMcp, "get_portfolio")).holdings[0].qty).toBe("100");
  });
});
