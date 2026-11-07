export function PageTitle({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="m-0 text-[32px] font-bold tracking-[-0.6px]">{title}</h1>
      {sub ? <p className="m-0 text-[15px] text-ink-2">{sub}</p> : null}
    </header>
  );
}

/** An empty state: why it's empty, and what fills it. */
export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <p className="m-0 text-[17px] font-semibold">{title}</p>
      <div className="mt-1 text-[15px] text-ink-2">{children}</div>
    </div>
  );
}

/** A record's id, so it can be named to an AI assistant: "delete trade #82". */
export function RowId({ id, label }: { id: number; label: string }) {
  return (
    <span title={`${label} #${id}: mention it to your AI assistant`} className="text-xs font-normal whitespace-nowrap text-muted tabular-nums">
      <span className="sr-only">{label} </span>#{id}
    </span>
  );
}

export const eyebrow = "text-[13px] font-semibold uppercase tracking-[.06em] text-muted";

export function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded-[7px] px-2 py-[3px] text-xs font-semibold whitespace-nowrap ${className}`}>{children}</span>;
}

export function Tally({ items }: { items: Array<{ label: string; dot: string; n: number }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item.label} className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px]">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${item.dot}`} />
          {item.label} <b className="font-bold tabular-nums">{item.n}</b>
        </span>
      ))}
    </div>
  );
}
