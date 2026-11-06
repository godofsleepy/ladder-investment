import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { Db } from "./db.js";
import { LadderError } from "./money.js";

export interface User {
  id: number;
  email: string;
  name: string;
  has_password: boolean;
  base_currency: "IDR" | "USD";
  start_page: "portfolio" | "watchlist";
  notify_zone: boolean;
  notify_review: boolean;
  notify_weekly: boolean;
  mcp_access: "ro" | "rw";
}

export interface Identity {
  userId: number;
  access: "ro" | "rw";
}

const USER_COLUMNS = `id, email, name, password_hash is not null as has_password, base_currency, start_page,
  notify_zone, notify_review, notify_weekly, mcp_access`;

const DAY_MS = 86_400_000;
export const SESSION_DAYS = 30;
const RESET_MS = 60 * 60_000;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newSecret = (bytes = 32) => randomBytes(bytes).toString("base64url");

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const given = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Compared against when an email has no account, so a miss takes as long as a wrong password.
let decoyHash: Promise<string> | undefined;

export function validEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254;
}

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new LadderError(`Password needs at least ${MIN_PASSWORD} characters.`);
  if (password.length > MAX_PASSWORD) throw new LadderError(`Password can't be longer than ${MAX_PASSWORD} characters.`);
}

/** LADDER_ALLOWED_EMAILS: addresses and @domains that may join, comma-separated. Empty means anyone who can reach this server. */
export function mayJoin(email: string, allowed = process.env.LADDER_ALLOWED_EMAILS ?? ""): boolean {
  const address = email.trim().toLowerCase();
  const list = allowed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some((entry) => (entry.startsWith("@") ? address.endsWith(entry) : address === entry));
}

const NOT_INVITED = "This Ladder is invite-only, and that address isn't on its list.";
const OWNED_TABLES = ["assets", "trades", "theses", "watchlist", "journal", "thesis_reviews"];

async function insertUser(
  db: Db,
  input: { email: string; name: string; passwordHash: string | null; googleSub: string | null },
): Promise<User> {
  try {
    const { rows } = await db.query<User>(
      `insert into users (email, name, password_hash, google_sub) values ($1,$2,$3,$4) returning ${USER_COLUMNS}`,
      [input.email, input.name, input.passwordHash, input.googleSub],
    );
    const user = rows[0] as User;
    // Anything logged before accounts existed belongs to the first person to join.
    const count = await db.query<{ n: number }>("select count(*)::int as n from users");
    if (count.rows[0]?.n === 1) {
      for (const table of OWNED_TABLES) {
        const skip = table === "assets" ? " and class <> 'fx'" : "";
        await db.query(`update ${table} set user_id = $1 where user_id is null${skip}`, [user.id]);
      }
    }
    return user;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new LadderError("An account with that email already exists. Try signing in.");
    }
    throw err;
  }
}

export async function createUser(db: Db, input: { email: string; name: string; password: string }): Promise<User> {
  const email = input.email.trim();
  const name = input.name.trim();
  if (!validEmail(email)) throw new LadderError("Enter a valid email address.");
  if (!name) throw new LadderError("Enter your name.");
  assertPassword(input.password);
  if (!mayJoin(email)) throw new LadderError(NOT_INVITED);
  return insertUser(db, { email, name, passwordHash: await hashPassword(input.password), googleSub: null });
}

export async function signIn(db: Db, emailInput: string, password: string): Promise<User | null> {
  const { rows } = await db.query<User & { password_hash: string | null }>(
    `select ${USER_COLUMNS}, password_hash from users where lower(email) = lower($1)`,
    [emailInput.trim()],
  );
  const found = rows[0];
  decoyHash ??= hashPassword(newSecret());
  const ok = await verifyPassword(password.slice(0, MAX_PASSWORD), found?.password_hash ?? (await decoyHash));
  if (!found?.password_hash || !ok) return null;
  const { password_hash: _hash, ...user } = found;
  return user;
}

/** Signs in with a Google profile: by Google id, then by verified email, or a new account. */
export async function googleUser(
  db: Db,
  profile: { sub: string; email: string; emailVerified: boolean; name: string },
): Promise<User> {
  const bySub = await db.query<User>(`select ${USER_COLUMNS} from users where google_sub = $1`, [profile.sub]);
  if (bySub.rows[0]) return bySub.rows[0];
  if (!profile.emailVerified) throw new LadderError("Google hasn't verified that email address.");
  const linked = await db.query<User>(
    `update users set google_sub = $1 where lower(email) = lower($2) returning ${USER_COLUMNS}`,
    [profile.sub, profile.email],
  );
  if (linked.rows[0]) return linked.rows[0];
  if (!mayJoin(profile.email)) throw new LadderError(NOT_INVITED);
  return insertUser(db, {
    email: profile.email,
    name: profile.name || profile.email.split("@")[0] || "Ladder user",
    passwordHash: null,
    googleSub: profile.sub,
  });
}

export async function createSession(db: Db, userId: number): Promise<{ token: string; expires: Date }> {
  const token = newSecret();
  const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.query("insert into sessions (user_id, token_hash, expires_at) values ($1,$2,$3)", [userId, sha256(token), expires]);
  return { token, expires };
}

/** The signed-in user, extending the session so someone who keeps using Ladder stays signed in. */
export async function sessionUser(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const { rows } = await db.query<User>(
    `update sessions s set expires_at = now() + make_interval(days => ${SESSION_DAYS})
     from users u where s.token_hash = $1 and s.expires_at > now() and u.id = s.user_id
     returning u.id, u.email, u.name, u.password_hash is not null as has_password, u.base_currency, u.start_page,
       u.notify_zone, u.notify_review, u.notify_weekly, u.mcp_access`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function endSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query("delete from sessions where token_hash = $1", [sha256(token)]);
}

export async function createPasswordReset(db: Db, email: string): Promise<{ token: string; email: string } | null> {
  const { rows } = await db.query<{ id: number; email: string }>(
    "select id, email from users where lower(email) = lower($1)",
    [email.trim()],
  );
  const user = rows[0];
  if (!user) return null;
  const token = newSecret();
  await db.query("insert into password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)", [
    sha256(token),
    user.id,
    new Date(Date.now() + RESET_MS),
  ]);
  return { token, email: user.email };
}

/** Sets a new password and signs out every device, since a reset may mean the old one leaked. */
export async function resetPassword(db: Db, token: string, password: string): Promise<void> {
  assertPassword(password);
  const { rows } = await db.query<{ user_id: number }>(
    `update password_resets set used_at = now()
     where token_hash = $1 and used_at is null and expires_at > now() returning user_id`,
    [sha256(token)],
  );
  const userId = rows[0]?.user_id;
  if (!userId) throw new LadderError("This reset link has expired or was already used. Ask for a new one.");
  await db.query("update users set password_hash = $2 where id = $1", [userId, await hashPassword(password)]);
  await db.query("delete from sessions where user_id = $1", [userId]);
}

export async function updatePreferences(
  db: Db,
  userId: number,
  changes: Partial<Pick<User, "base_currency" | "start_page" | "notify_zone" | "notify_review" | "notify_weekly" | "mcp_access">>,
): Promise<void> {
  await db.query(
    `update users set base_currency = coalesce($2, base_currency), start_page = coalesce($3, start_page),
       notify_zone = coalesce($4, notify_zone), notify_review = coalesce($5, notify_review),
       notify_weekly = coalesce($6, notify_weekly), mcp_access = coalesce($7, mcp_access)
     where id = $1`,
    [
      userId,
      changes.base_currency ?? null,
      changes.start_page ?? null,
      changes.notify_zone ?? null,
      changes.notify_review ?? null,
      changes.notify_weekly ?? null,
      changes.mcp_access ?? null,
    ],
  );
}

export async function deleteUser(db: Db, userId: number): Promise<void> {
  await db.query("delete from users where id = $1", [userId]);
}

const TOKEN_PREFIX = "ldr_";
export const newApiToken = () => TOKEN_PREFIX + newSecret(24);

export async function createApiToken(db: Db, userId: number, name = "Access token"): Promise<{ id: number; token: string }> {
  const token = newApiToken();
  const { rows } = await db.query<{ id: number }>(
    "insert into api_tokens (user_id, kind, name, token_hash, suffix) values ($1,'token',$2,$3,$4) returning id",
    [userId, name.trim().slice(0, 60) || "Access token", sha256(token), token.slice(-4)],
  );
  return { id: (rows[0] as { id: number }).id, token };
}

export interface Connection {
  id: number;
  kind: "token" | "oauth";
  name: string;
  suffix: string;
  created_at: Date;
  last_used_at: Date | null;
}

export async function listConnections(db: Db, userId: number): Promise<Connection[]> {
  const { rows } = await db.query<Connection>(
    `select id, kind, name, suffix, created_at, last_used_at from api_tokens
     where user_id = $1 and (refresh_expires_at is null or refresh_expires_at > now())
     order by created_at`,
    [userId],
  );
  return rows;
}

export async function revokeConnection(db: Db, userId: number, id: number): Promise<void> {
  await db.query("delete from api_tokens where id = $1 and user_id = $2", [id, userId]);
}

/** Who an API or OAuth token acts as, or null. Access comes from the account, so changing it applies at once. */
export async function tokenIdentity(db: Db, token: string): Promise<Identity | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const { rows } = await db.query<{ user_id: number; mcp_access: "ro" | "rw" }>(
    `update api_tokens t set last_used_at = now() from users u
     where t.token_hash = $1 and (t.expires_at is null or t.expires_at > now()) and u.id = t.user_id
     returning t.user_id, u.mcp_access`,
    [sha256(token)],
  );
  const row = rows[0];
  return row ? { userId: row.user_id, access: row.mcp_access } : null;
}

/**
 * Who a local stdio server acts as: LADDER_TOKEN, or the only account on this machine.
 * Anyone able to start it already holds the database password, so the single-account shortcut gives nothing away.
 */
export async function localIdentity(db: Db, token = process.env.LADDER_TOKEN): Promise<Identity> {
  if (token) {
    const identity = await tokenIdentity(db, token);
    if (!identity) throw new LadderError("LADDER_TOKEN isn't a valid token. Create a new one on the Account page.");
    return identity;
  }
  const { rows } = await db.query<{ id: number; mcp_access: "ro" | "rw" }>("select id, mcp_access from users limit 2");
  if (rows.length === 0) throw new LadderError("No Ladder account yet. Create one on the dashboard first.");
  if (rows.length > 1) throw new LadderError("This Ladder has several accounts. Set LADDER_TOKEN to choose one.");
  const only = rows[0] as { id: number; mcp_access: "ro" | "rw" };
  return { userId: only.id, access: only.mcp_access };
}

// Failed sign-ins slow everyone down, not one address: after FREE_TRIES misses each further
// miss locks sign-in, doubling from 30 seconds up to 15 minutes. A success resets it.
const FREE_TRIES = 5;
const failures = { count: 0, until: 0 };

export const loginLockedFor = (now = Date.now()) => Math.max(0, failures.until - now);

export function recordLoginFailure(now = Date.now()): void {
  failures.count += 1;
  const over = failures.count - FREE_TRIES;
  if (over > 0) failures.until = now + Math.min(30_000 * 2 ** (over - 1), 15 * 60_000);
}

export function resetLoginFailures(): void {
  failures.count = 0;
  failures.until = 0;
}

/** Where to go after signing in: a path on this site only. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next === "/login" || next.startsWith("/login?") ? null : next;
}
