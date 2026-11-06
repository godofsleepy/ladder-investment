import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiToken, createUser, deleteUser, updatePreferences, type User } from "../src/auth.js";
import { closePool, getPool } from "../src/db.js";
import { googleAuthUrl, googleProfile } from "../src/google.js";
import { handleMcp, handleRegister, handleToken } from "../src/http.js";
import { migrate } from "../src/migrate.js";
import { authorizationServerMetadata, createAuthCode, findClient, protectedResourceMetadata } from "../src/oauth.js";

const base = "https://ladder.test";
const mcpHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
let user: User;
let token: string;

function rpc(method: string, params: unknown, extra: Record<string, string> = {}) {
  return new Request(`${base}/mcp`, {
    method: "POST",
    headers: { ...mcpHeaders, ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const init = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } };

beforeAll(async () => {
  await migrate();
  user = await createUser(getPool(), { email: "http@example.com", name: "Http", password: "correct horse" });
  token = (await createApiToken(getPool(), user.id)).token;
});

afterAll(async () => {
  await deleteUser(getPool(), user.id);
  await closePool();
  vi.unstubAllGlobals();
});

describe("MCP over HTTP", () => {
  it("answers no token with a pointer to how to sign in", async () => {
    const res = await handleMcp(rpc("initialize", init), base);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`${base}/.well-known/oauth-protected-resource`);
  });

  it("refuses a bad token and a cross-site browser origin", async () => {
    expect((await handleMcp(rpc("initialize", init, bearer("ldr_nope")), base)).status).toBe(401);
    expect((await handleMcp(rpc("initialize", init, { ...bearer(token), Origin: "https://evil.example" }), base)).status).toBe(403);
  });

  it("serves tools to a valid token", async () => {
    const res = await handleMcp(rpc("initialize", init, bearer(token)), base);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("ladder");

    const list = await handleMcp(rpc("tools/list", {}, { ...bearer(token), "Mcp-Protocol-Version": "2025-06-18" }), base);
    const tools = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(tools).toContain("log_trade");
  });

  it("drops write tools the moment the account switches to read only", async () => {
    await updatePreferences(getPool(), user.id, { mcp_access: "ro" });
    const list = await handleMcp(rpc("tools/list", {}, { ...bearer(token), "Mcp-Protocol-Version": "2025-06-18" }), base);
    const tools = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(tools).toContain("get_portfolio");
    expect(tools).not.toContain("log_trade");
    await updatePreferences(getPool(), user.id, { mcp_access: "rw" });
  });
});

describe("OAuth endpoints", () => {
  it("publishes discovery documents", () => {
    expect(protectedResourceMetadata(base)).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    expect(authorizationServerMetadata(base)).toMatchObject({ registration_endpoint: `${base}/oauth/register`, code_challenge_methods_supported: ["S256"] });
  });

  it("registers a client, exchanges a code and uses the token on /mcp", async () => {
    const redirect = "http://localhost:50000/cb";
    const reg = await handleRegister(new Request(`${base}/oauth/register`, { method: "POST", body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [redirect] }) }));
    expect(reg.status).toBe(201);
    const { client_id: clientId } = (await reg.json()) as { client_id: string };

    const verifier = "another-long-random-verifier-used-only-in-this-test";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const client = (await findClient(getPool(), clientId))!;
    const code = await createAuthCode(getPool(), { client, redirectUri: redirect, codeChallenge: challenge, state: null }, user.id);

    const res = await handleToken(new Request(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const tokens = (await res.json()) as { access_token: string };
    expect((await handleMcp(rpc("initialize", init, bearer(tokens.access_token)), base)).status).toBe(200);
  });

  it("answers bad requests in the OAuth error shape", async () => {
    const res = await handleToken(new Request(`${base}/oauth/token`, { method: "POST", body: "grant_type=password" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unsupported_grant_type" });
    const bad = await handleRegister(new Request(`${base}/oauth/register`, { method: "POST", body: "not json" }));
    expect(bad.status).toBe(400);
  });
});

describe("Google sign-in", () => {
  it("reads the profile from Google's token response", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(googleAuthUrl(`${base}/auth/google/callback`, "s1")).toContain("state=s1");
    const claims = Buffer.from(JSON.stringify({ sub: "1", email: "g@example.com", email_verified: true, name: "G" })).toString("base64url");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id_token: `x.${claims}.y` })));
    expect(await googleProfile("code", `${base}/cb`)).toEqual({ sub: "1", email: "g@example.com", emailVerified: true, name: "G" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })));
    await expect(googleProfile("code", `${base}/cb`)).rejects.toThrow(/didn't finish/);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
});
