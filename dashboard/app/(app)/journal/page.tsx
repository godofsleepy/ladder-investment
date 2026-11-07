import { today } from "@ladder/dates";
import Link from "next/link";
import { JournalSearch } from "@/components/JournalSearch";
import { PageActions } from "@/components/PageActions";
import { Empty, RowId } from "@/components/ui";
import { fd } from "@/lib/format";
import { assets, notes, type Note } from "@/lib/ladder";

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? "";
  const [result, options] = await Promise.all([notes(q || undefined), assets()]);
  const list = (result.matches as Note[]).filter((m) => m.kind === "note");

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[32px] font-bold tracking-[-0.6px]">Journal</h1>
          <p className="m-0 text-[15px] text-ink-2">Your notes and Ladder's alerts, tagged to holdings.</p>
        </div>
        <PageActions assets={options} today={today()} only="note" />
      </header>
      <JournalSearch initial={q} />
      {list.length === 0 && !q ? (
        <Empty title="No notes yet">Add one here, or tell your agent what you're thinking.</Empty>
      ) : (
        <section aria-label="Notes" className="card overflow-hidden">
          {list.map((note, i) => (
            <div key={note.id} className={`grid grid-cols-[72px_minmax(0,1fr)] gap-4 px-5 py-3.5 ${i > 0 ? "border-t border-line-soft" : ""}`}>
              <span className="pt-0.5 text-[13px] text-muted tabular-nums">{fd(note.created_at)}</span>
              <div className="flex flex-col gap-2">
                <span className="text-sm leading-normal text-pretty">{note.text}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {note.symbol ? <Link href={`/assets/${note.symbol}?from=journal`} className="flex h-6 items-center rounded-[7px] bg-brand-soft px-2 text-xs font-semibold">{note.symbol}</Link> : null}
                  {note.tags.map((tag) => <span key={tag} className="flex h-6 items-center rounded-[7px] bg-fill px-2 text-xs font-semibold text-ink-2">{tag}</span>)}
                  <span className={`text-xs ${note.author === "You" ? "text-muted" : "text-brand"}`}>{note.author}</span>
                  <RowId id={note.id} label="Note" />
                </div>
              </div>
            </div>
          ))}
          {list.length === 0 ? <div className="px-5 py-6 text-center text-sm text-muted">No notes match “{q}”.</div> : null}
        </section>
      )}
    </>
  );
}
