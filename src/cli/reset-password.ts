import { createPasswordReset } from "../auth.js";
import { closePool, getPool } from "../db.js";

// For when SMTP isn't set up: run on the server, open the link, choose a new password.
const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run reset-password you@example.com");
  process.exit(1);
}
const reset = await createPasswordReset(getPool(), email);
console.log(reset ? `Open this within an hour: /reset?token=${reset.token}` : `No account with the email ${email}`);
await closePool();
