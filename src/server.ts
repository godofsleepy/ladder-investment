import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { localIdentity } from "./auth.js";
import { closePool, getPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createServer } from "./tools.js";

await migrate();
const identity = await localIdentity(getPool()).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
await createServer(identity).connect(new StdioServerTransport());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void closePool().finally(() => process.exit(0)));
}
