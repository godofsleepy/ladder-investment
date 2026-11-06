import { crc32 } from "node:zlib";
import { today } from "./dates.js";
import type { Db } from "./db.js";
import { getPortfolio } from "./portfolio.js";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join(" ") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** A plain zip with no compression, enough to carry a few small CSV files. */
function zip(files: Array<{ name: string; text: string }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.text);
    const crc = crc32(data);
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0); // version needed
    shared.writeUInt16LE(0x0800, 2); // UTF-8 names
    shared.writeUInt16LE(0, 4); // stored
    shared.writeUInt16LE(0x21, 8); // 1 Jan 1980, the earliest date a zip can hold
    shared.writeUInt32LE(crc, 10);
    shared.writeUInt32LE(data.length, 14);
    shared.writeUInt32LE(data.length, 18);
    shared.writeUInt16LE(name.length, 22);

    const local = Buffer.alloc(4);
    local.writeUInt32LE(0x04034b50, 0);
    parts.push(local, shared, name, data);

    const head = Buffer.alloc(6);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // version made by
    const tail = Buffer.alloc(14);
    tail.writeUInt32LE(offset, 10);
    central.push(head, shared, tail, name);

    offset += 4 + shared.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Everything in the account as CSV files in one zip. Runs inside the account's own read-only transaction. */
export async function exportAccount(db: Db): Promise<{ filename: string; body: Buffer }> {
  const trades = await db.query(
    `select t.traded_at as date, a.symbol, t.type, t.qty, t.price, t.fee, t.currency, t.fx_to_idr, t.platform, t.note
     from trades t join assets a on a.id = t.asset_id order by t.traded_at, t.id`,
  );
  const theses = await db.query(
    `select a.symbol, t.title, t.why, t.kill_criteria, t.kill_price, t.target_price, t.horizon, t.conviction,
       t.status, t.outcome, t.opened_at, t.closed_at, t.next_review_at
     from theses t join assets a on a.id = t.asset_id order by t.id`,
  );
  const watchlist = await db.query(
    `select a.symbol, w.zone_low, w.zone_high, w.reason, w.priority, w.planned_amount_idr, w.status, w.drop_reason, w.added_at, w.closed_at
     from watchlist w join assets a on a.id = w.asset_id order by w.id`,
  );
  const journal = await db.query(
    `select j.created_at, a.symbol, j.thesis_id, j.body, j.tags
     from journal j left join assets a on a.id = j.asset_id order by j.created_at, j.id`,
  );
  const { holdings } = await getPortfolio(db);

  const date = today();
  return {
    filename: `ladder-export-${date}.zip`,
    body: zip([
      { name: "trades.csv", text: toCsv(["date", "symbol", "type", "qty", "price", "fee", "currency", "fx_to_idr", "platform", "note"], trades.rows) },
      { name: "holdings.csv", text: toCsv(["symbol", "name", "class", "qty", "price", "price_currency", "price_date", "cost_idr", "value_idr", "unrealized_idr", "realized_idr"], holdings) },
      { name: "theses.csv", text: toCsv(["symbol", "title", "why", "kill_criteria", "kill_price", "target_price", "horizon", "conviction", "status", "outcome", "opened_at", "closed_at", "next_review_at"], theses.rows) },
      { name: "watchlist.csv", text: toCsv(["symbol", "zone_low", "zone_high", "reason", "priority", "planned_amount_idr", "status", "drop_reason", "added_at", "closed_at"], watchlist.rows) },
      { name: "journal.csv", text: toCsv(["created_at", "symbol", "thesis_id", "body", "tags"], journal.rows) },
    ]),
  };
}
