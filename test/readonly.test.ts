import { afterAll, beforeAll, expect, it } from "vitest";
import { createUser, deleteUser, type User } from "../src/auth.js";
import { closePool, getPool, withUser } from "../src/db.js";
import { migrate } from "../src/migrate.js";

let user: User;

beforeAll(async () => {
  await migrate();
  user = await createUser(getPool(), { email: "readonly@example.com", name: "Read Only", password: "correct horse" });
});

afterAll(async () => {
  await deleteUser(getPool(), user.id);
  await closePool();
});

it("reads but refuses every write on a read-only transaction", async () => {
  const assets = await withUser(user.id, (db) => db.query("select count(*)::int as n from assets"), { readOnly: true });
  expect(assets.rows[0].n).toBeGreaterThan(0);
  await expect(
    withUser(user.id, (db) => db.query("insert into journal (body) values ('nope')"), { readOnly: true }),
  ).rejects.toThrow(/read-only/);
});
