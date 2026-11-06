import { existsSync } from "node:fs";
import pg from "pg";

/** Recreates ladder_test on the same server, so tests never touch real data. */
export default async function setup() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = new URL(process.env.DATABASE_URL as string);
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query("drop database if exists ladder_test with (force)");
  await admin.query("create database ladder_test");
  await admin.end();
  url.pathname = "/ladder_test";
  process.env.DATABASE_URL = url.toString();
}
