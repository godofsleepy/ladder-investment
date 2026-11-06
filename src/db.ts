import pg from "pg";
import { databaseUrl } from "./config.js";

// Keep DATE columns as YYYY-MM-DD strings; the default parser shifts them by timezone.
pg.types.setTypeParser(1082, (v) => v);

export type Db = Pick<pg.PoolClient, "query">;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl(), max: 5 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Runs work in a transaction. Tool code takes this so it never chooses its own account. */
export type Tx = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/**
 * Runs as one account. The ladder_app role is bound by row-level security, so every query
 * in here sees only that account's rows, and readOnly makes Postgres refuse any write.
 */
export async function withUser<T>(
  userId: number,
  fn: (db: Db) => Promise<T>,
  { readOnly = false }: { readOnly?: boolean } = {},
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query(readOnly ? "begin read only" : "begin");
    await client.query("set local role ladder_app");
    await client.query("select set_config('app.user_id', $1, true)", [String(userId)]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function withTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
