import { withUser } from "@ladder/db";
import { exportAccount } from "@ladder/export";
import { requireUser } from "@/lib/session";

export async function GET() {
  const user = await requireUser();
  const { filename, body } = await withUser(user.id, (db) => exportAccount(db), { readOnly: true });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
