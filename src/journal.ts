import { requireAsset } from "./assets.js";
import type { Db } from "./db.js";
import { LadderError } from "./money.js";

export async function addNote(
  db: Db,
  input: { body: string; symbol?: string; thesis_id?: number; tags?: string[]; author?: string },
) {
  if (!input.body.trim()) throw new LadderError("A note needs a body");
  let assetId = input.symbol ? (await requireAsset(db, input.symbol)).id : null;
  if (input.thesis_id !== undefined) {
    const thesis = await db.query<{ asset_id: number }>("select asset_id from theses where id = $1", [input.thesis_id]);
    if (!thesis.rows[0]) throw new LadderError(`No thesis ${input.thesis_id}`);
    assetId ??= thesis.rows[0].asset_id;
  }
  const { rows } = await db.query(
    `insert into journal (asset_id, thesis_id, body, tags, author) values ($1,$2,$3,$4,$5)
     returning id, thesis_id, body, tags, author, created_at`,
    [assetId, input.thesis_id ?? null, input.body, input.tags ?? [], input.author ?? "You"],
  );
  return rows[0];
}

function escapeLike(word: string): string {
  return word.replace(/[\\%_]/g, "\\$&");
}

/** Keyword search over notes and theses. Every word must appear. Empty text lists the newest. */
export async function searchNotes(db: Db, input: { text?: string; symbol?: string; tag?: string; limit?: number }) {
  const assetId = input.symbol ? (await requireAsset(db, input.symbol)).id : null;
  const patterns = (input.text ?? "").split(/\s+/).filter(Boolean).map((w) => `%${escapeLike(w)}%`);
  const { rows } = await db.query(
    `select * from (
       select 'note' as kind, j.id, a.symbol, j.body as text, j.tags, j.author, j.created_at
       from journal j left join assets a on a.id = j.asset_id
       where ($1::int is null or j.asset_id = $1)
         and ($3::text is null or $3 = any(j.tags))
         and (j.body || ' ' || coalesce(a.symbol, '')) ilike all($2::text[])
       union all
       select 'thesis', t.id, a.symbol, t.title || ': ' || t.why || ' Kill criteria: ' || t.kill_criteria,
              '{}'::text[], 'You', t.created_at
       from theses t join assets a on a.id = t.asset_id
       where ($1::int is null or t.asset_id = $1)
         and $3::text is null
         and (t.title || ' ' || t.why || ' ' || t.kill_criteria) ilike all($2::text[])
     ) hits order by created_at desc limit $4`,
    [assetId, patterns, input.tag ?? null, input.limit ?? 20],
  );
  return { count: rows.length, matches: rows };
}

export async function recentNotes(db: Db, assetId: number, limit = 10) {
  const { rows } = await db.query(
    "select id, thesis_id, body, tags, author, created_at from journal where asset_id = $1 order by created_at desc, id desc limit $2",
    [assetId, limit],
  );
  return rows;
}

export async function allTags(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ tag: string }>(
    "select distinct unnest(tags) as tag from journal order by tag",
  );
  return rows.map((r) => r.tag);
}
