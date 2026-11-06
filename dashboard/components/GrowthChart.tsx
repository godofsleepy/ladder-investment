"use client";
import { useMemo, useState } from "react";
import { fd, moneyOf, monthYear, pct1, type Money } from "@/lib/format";

interface Point {
  date: string;
  value: number;
  invested: number;
  by: Record<string, number | null>;
}

type Range = "6m" | "1y" | "all";

const RANGES: Array<{ key: Range; label: string; months: number | null }> = [
  { key: "6m", label: "6M", months: 6 },
  { key: "1y", label: "1Y", months: 12 },
  { key: "all", label: "All", months: null },
];

const LINE_COLORS = ["#c26a00", "#2f8a3a", "#7a4fd0", "#0a8a9a", "#c2387a", "var(--color-muted)", "#9a6b00", "#b8860b", "var(--color-ink-2)"];
const ALL = "__portfolio";

function cutoff(last: string, months: number): string {
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Round axis steps, fine enough that the line fills the chart, three steps to the top. */
function axisStep(top: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(top, 1) / 3));
  return [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].map((m) => m * magnitude).find((s) => s * 3 >= top) ?? top / 3;
}

const pathOf = (values: Array<number | null>, x: (i: number) => number, y: (v: number) => number) => {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
};

export function GrowthChart({ points, symbols, base }: { points: Point[]; symbols: string[]; base: Money }) {
  const [range, setRange] = useState<Range>("all");
  const [selected, setSelected] = useState<string[]>([ALL]);
  const [hover, setHover] = useState<number | null>(null);
  const { money, signed } = moneyOf(base);

  const visible = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)?.months;
    if (!months || points.length === 0) return points;
    const from = cutoff((points.at(-1) as Point).date, months);
    return points.filter((p) => p.date >= from);
  }, [points, range]);

  const colorOf = (id: string) => (id === ALL ? "var(--color-brand)" : (LINE_COLORS[symbols.indexOf(id) % LINE_COLORS.length] as string));
  const labelOf = (id: string) => (id === ALL ? "Portfolio" : id);
  const compare = !(selected.length === 1 && selected[0] === ALL);
  const n = visible.length;

  const lines = selected.map((id) => ({
    id,
    values: visible.map((p) => (id === ALL ? p.value : (p.by[id] ?? null))),
  }));
  const peak = Math.max(1, ...(compare ? lines.flatMap((l) => l.values.filter((v): v is number => v !== null)) : visible.flatMap((p) => [p.value, p.invested]))) * 1.04;
  const step = axisStep(peak);
  const yMax = step * 3;
  const x = (i: number) => (n > 1 ? i / (n - 1) : 0) * 1000;
  const y = (v: number) => 300 - (v / yMax) * 300;

  const at = hover !== null && hover < n ? hover : n - 1;
  const point = visible[at];
  const gain = point ? point.value - point.invested : 0;
  const first = points[0];
  const since =
    range === "all"
      ? `Since your first trade, ${first ? monthYear(first.date) : ""}`
      : `Last ${range === "6m" ? "6 months" : "12 months"}`;
  const dateLabel = hover === null ? "Today" : fd(point?.date);
  const ticks = [0, 1, 2, 3].map((j) => visible[Math.round((j / 3) * (n - 1))]?.date).filter((d): d is string => Boolean(d));

  function toggle(id: string) {
    setHover(null);
    setSelected((current) => {
      const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
      return next.length > 0 ? next : [ALL];
    });
  }

  return (
    <section aria-labelledby="growth" className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="growth" className="m-0 text-[17px] font-bold">Growth</h2>
          <span className="text-[13px] text-muted">{since}</span>
        </div>
        <div role="group" aria-label="Time range" className="flex gap-1 rounded-[11px] bg-fill p-[3px]">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => {
                setRange(r.key);
                setHover(null);
              }}
              className={`h-7 rounded-lg px-3 text-[13px] font-semibold text-ink ${range === r.key ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)]" : ""}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label="Lines on the chart" className="flex flex-wrap gap-1.5">
        {[ALL, ...symbols].map((id) => {
          const on = selected.includes(id);
          const color = colorOf(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(id)}
              style={{ borderColor: on ? color : undefined }}
              className="inline-flex h-[34px] items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-2.5 text-[13px] font-semibold whitespace-nowrap text-ink hover:border-ink-2"
            >
              <span aria-hidden="true" className="flex h-3.5 w-3.5 items-center justify-center rounded border-2 box-border" style={{ borderColor: color, background: on ? color : "transparent" }}>
                {on ? (
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-4.9" /></svg>
                ) : null}
              </span>
              {labelOf(id)}
            </button>
          );
        })}
      </div>

      {n < 2 ? (
        <p className="m-0 text-sm text-ink-2">The chart starts once there are two days of history. Refresh prices to fetch it.</p>
      ) : (
        <>
          {compare ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted">{dateLabel} · value</span>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {lines.map((line) => {
                  const v = line.values[at] ?? null;
                  return (
                    <span key={line.id} className="inline-flex items-center gap-2 text-sm">
                      <span aria-hidden="true" className="h-[3px] w-4 rounded-sm" style={{ background: colorOf(line.id) }} />
                      <span className="font-semibold">{labelOf(line.id)}</span>
                      <span className={`font-bold tabular-nums ${v === null ? "text-muted" : ""}`}>{v === null ? "not held yet" : money(v)}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-7">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{dateLabel}</span>
                <span className="text-[22px] font-bold tracking-[-0.4px] tabular-nums">{money(point?.value)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">Invested</span>
                <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{money(point?.invested)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">Gain</span>
                <span className={`text-[15px] font-semibold tabular-nums ${gain < 0 ? "text-bad" : "text-good"}`}>
                  {signed(gain)} ({pct1(point?.invested ? (gain / point.invested) * 100 : 0)})
                </span>
              </div>
              <div className="ml-auto flex gap-3.5 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-[3px] w-3.5 rounded-sm bg-brand" />Value</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-faint" />Invested</span>
              </div>
            </div>
          )}

          <div className="relative h-[220px] pl-[60px]">
            {[3, 2, 1, 0].map((j, row) => (
              <span key={j} className="absolute left-0 -translate-y-1/2 text-[11px] text-muted tabular-nums" style={{ top: `${(row / 3) * 100}%` }}>
                {money(step * j)}
              </span>
            ))}
            <div className="relative h-full">
              <div className="absolute inset-x-0 top-0 border-t border-dashed border-line-soft" />
              <div className="absolute inset-x-0 top-1/3 border-t border-dashed border-line-soft" />
              <div className="absolute inset-x-0 top-2/3 border-t border-dashed border-line-soft" />
              <div className="absolute inset-x-0 bottom-0 border-t border-line" />
              <svg
                viewBox="0 0 1000 300"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Portfolio value ${money((visible.at(-1) as Point).value)}, invested ${money((visible.at(-1) as Point).invested)}`}
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                {compare ? (
                  lines.map((line) => (
                    <path key={line.id} d={pathOf(line.values, x, y)} fill="none" stroke={colorOf(line.id)} strokeWidth={line.id === ALL ? 3 : 2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  ))
                ) : (
                  <>
                    <path d={`${pathOf(visible.map((p) => p.value), x, y)}L1000,300L0,300Z`} className="fill-brand/10" />
                    <path d={pathOf(visible.map((p) => p.invested), x, y)} fill="none" className="stroke-faint" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                    <path d={pathOf(visible.map((p) => p.value), x, y)} fill="none" className="stroke-brand" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </>
                )}
              </svg>
              {hover !== null && point ? (
                <>
                  <div className="pointer-events-none absolute inset-y-0 border-l border-line" style={{ left: `${x(at) / 10}%` }} />
                  {compare ? null : (
                    <div
                      className="pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full bg-brand shadow-[0_0_0_3px_var(--color-surface)]"
                      style={{ left: `${x(at) / 10}%`, top: `${y(point.value) / 3}%` }}
                    />
                  )}
                </>
              ) : null}
              <div
                aria-hidden="true"
                className="absolute inset-0 cursor-crosshair touch-pan-y"
                onPointerMove={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
                }}
                onPointerLeave={() => setHover(null)}
              />
            </div>
          </div>
          <div className="flex justify-between pl-[60px] text-[11px] text-muted">
            {ticks.map((date, i) => <span key={`${date}${i}`}>{monthYear(date)}</span>)}
          </div>
        </>
      )}
    </section>
  );
}

