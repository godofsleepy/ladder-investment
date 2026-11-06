import { closePool } from "../db.js";
import { migrate } from "../migrate.js";

const applied = await migrate();
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date");
await closePool();
