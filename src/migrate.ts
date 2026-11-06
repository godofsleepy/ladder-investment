import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { getPool } from "./db.js";

const LOCK_KEY = 7215501;

export async function migrate(): Promise<string[]> {
  const dir = path.join(ROOT, "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = await client.query<{ name: string }>("select name from schema_migrations");
    const seen = new Set(done.rows.map((r) => r.name));
    for (const file of files) {
      if (seen.has(file)) continue;
      await client.query("begin");
      try {
        await client.query(readFileSync(path.join(dir, file), "utf8"));
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return applied;
}
