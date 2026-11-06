import { createHash } from "node:crypto";
import { newApiToken, newSecret, sha256 } from "./auth.js";
import type { Db } from "./db.js";

const CODE_MS = 5 * 60_000;
const ACCESS_S = 3600;
const REFRESH_DAYS = 180;
const MAX_CLIENTS = 1000;
const MAX_REDIRECTS = 10;

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface Client {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

/** https anywhere, or http only back to this machine, as native apps and CLIs use. */
function allowedRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Dynamic client registration. The endpoint is open by design, so it only stores what a sign-in can later use. */
export async function registerClient(db: Db, input: { client_name?: unknown; redirect_uris?: unknown }): Promise<Client> {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must list between 1 and 10 addresses");
  }
  if (!uris.every((u) => typeof u === "string" && u.length <= 2000 && allowedRedirect(u))) {
    throw new OAuthError("invalid_redirect_uri", "Each redirect URI must be https, or http on localhost");
  }
  const count = await db.query<{ n: number }>("select count(*)::int as n from oauth_clients");
  if ((count.rows[0]?.n ?? 0) >= MAX_CLIENTS) throw new OAuthError("temporarily_unavailable", "Too many registered clients", 503);
  const name = typeof input.client_name === "string" ? input.client_name.trim().slice(0, 60) : "";
  const { rows } = await db.query<Client>(
    "insert into oauth_clients (client_id, client_name, redirect_uris) values ($1,$2,$3) returning client_id, client_name, redirect_uris",
    [`ldr_client_${newSecret(16)}`, name || "AI assistant", uris],
  );
  return rows[0] as Client;
}

export async function findClient(db: Db, clientId: string): Promise<Client | null> {
  const { rows } = await db.query<Client>(
    "select client_id, client_name, redirect_uris from oauth_clients where client_id = $1",
    [clientId],
  );
  return rows[0] ?? null;
}

export interface AuthorizeRequest {
  client: Client;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
}

/** Checks an authorization request. A bad client or redirect URI must never redirect, so both throw. */
export async function validateAuthorize(
  db: Db,
  params: { client_id?: string; redirect_uri?: string; response_type?: string; code_challenge?: string; code_challenge_method?: string; state?: string },
): Promise<AuthorizeRequest> {
  const client = params.client_id ? await findClient(db, params.client_id) : null;
  if (!client) throw new OAuthError("invalid_client", "This assistant isn't registered with Ladder");
  const redirectUri = params.redirect_uri ?? "";
  if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError("invalid_request", "That redirect address wasn't registered");
  if (params.response_type !== "code") throw new OAuthError("unsupported_response_type", "Only the code flow is supported");
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    throw new OAuthError("invalid_request", "PKCE with S256 is required");
  }
  return { client, redirectUri, codeChallenge: params.code_challenge, state: params.state ?? null };
}

export async function createAuthCode(db: Db, request: AuthorizeRequest, userId: number): Promise<string> {
  const code = newSecret();
  await db.query(
    `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [sha256(code), request.client.client_id, userId, request.redirectUri, request.codeChallenge, new Date(Date.now() + CODE_MS)],
  );
  return code;
}

function tokenResponse(accessToken: string, refreshToken: string) {
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_S, refresh_token: refreshToken };
}

const accessExpiry = () => new Date(Date.now() + ACCESS_S * 1000);
const refreshExpiry = () => new Date(Date.now() + REFRESH_DAYS * 86_400_000);
const invalidGrant = (message: string) => new OAuthError("invalid_grant", message);

export async function exchangeCode(
  db: Db,
  input: { code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string },
) {
  if (!input.code || !input.client_id || !input.redirect_uri || !input.code_verifier) {
    throw new OAuthError("invalid_request", "code, client_id, redirect_uri and code_verifier are required");
  }
  const { rows } = await db.query<{ client_id: string; user_id: number; redirect_uri: string; code_challenge: string }>(
    `update oauth_codes set used_at = now()
     where code_hash = $1 and used_at is null and expires_at > now()
     returning client_id, user_id, redirect_uri, code_challenge`,
    [sha256(input.code)],
  );
  const grant = rows[0];
  if (!grant) throw invalidGrant("That code has expired or was already used");
  if (grant.client_id !== input.client_id || grant.redirect_uri !== input.redirect_uri) {
    throw invalidGrant("That code was issued to a different client");
  }
  const challenge = createHash("sha256").update(input.code_verifier).digest("base64url");
  if (challenge !== grant.code_challenge) throw invalidGrant("The PKCE verifier doesn't match");

  const client = (await findClient(db, grant.client_id)) as Client;
  const access = newApiToken();
  const refresh = newApiToken();
  await db.query(
    `insert into api_tokens (user_id, kind, name, token_hash, suffix, client_id, refresh_hash, expires_at, refresh_expires_at)
     values ($1,'oauth',$2,$3,$4,$5,$6,$7,$8)`,
    [grant.user_id, client.client_name, sha256(access), access.slice(-4), client.client_id, sha256(refresh), accessExpiry(), refreshExpiry()],
  );
  return tokenResponse(access, refresh);
}

/** Refresh tokens rotate: each one works once. */
export async function refreshGrant(db: Db, input: { refresh_token?: string; client_id?: string }) {
  if (!input.refresh_token || !input.client_id) throw new OAuthError("invalid_request", "refresh_token and client_id are required");
  const access = newApiToken();
  const refresh = newApiToken();
  const { rowCount } = await db.query(
    `update api_tokens set token_hash = $1, suffix = $2, refresh_hash = $3, expires_at = $4, refresh_expires_at = $5
     where refresh_hash = $6 and client_id = $7 and refresh_expires_at > now()`,
    [sha256(access), access.slice(-4), sha256(refresh), accessExpiry(), refreshExpiry(), sha256(input.refresh_token), input.client_id],
  );
  if (!rowCount) throw invalidGrant("That refresh token has expired or was already used");
  return tokenResponse(access, refresh);
}

/** What an MCP client reads to find out how to sign in. */
export function protectedResourceMetadata(base: string) {
  return { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"], resource_name: "Ladder" };
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}
