import { closePool, getPool, withTx } from "../db.js";
import { migrate } from "../migrate.js";
import { sendDueEmails } from "../notify.js";
import { refreshPrices } from "../prices/refresh.js";

await migrate();
const result = await withTx((db) => refreshPrices(db));
const emails = await sendDueEmails(getPool());
console.log(JSON.stringify({ ...result, emails }, null, 2));
await closePool();
process.exitCode = result.failed.length > 0 ? 1 : 0;
