"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { fd, MINUS, moneyOf, monthYear, pct1, type Money } from "@/lib/format";

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
const GAIN = "__gain";

export function cutoff(last: string, months: number): string {
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Round axis step, fine enough that the line fills the chart. */
function niceStep(target: number): number {
  const safe = Math.max(target, 1);
  const magnitude = 10 ** Math.floor(Math.log10(safe));
  return [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].map((m) => m * magnitude).find((s) => s >= safe) ?? safe;
}

/** Three equal intervals (four ticks), placing zero on a gridline whenever values cross it. */
function computeScale(values: number[]): { yMin: number; yMax: number; ticks: [number, number, number, number]; zeroRow: number } {
  const rawMin = values.length > 0 ? Math.min(...values) : 0;
  const rawMax = values.length > 0 ? Math.max(...values) : 0;

  if (rawMin >= 0) {
    const step = niceStep((Math.max(1, rawMax) * 1.04) / 3);
    return { yMin: 0, yMax: step * 3, ticks: [step * 3, step * 2, step, 0], zeroRow: 3 };
  }
  if (rawMax <= 0) {
    const step = niceStep((Math.max(1, Math.abs(rawMin)) * 1.04) / 3);
    return { yMin: -step * 3, yMax: 0, ticks: [0, -step, -step * 2, -step * 3], zeroRow: 0 };
  }
  if (rawMax >= Math.abs(rawMin)) {
    const step = niceStep(Math.max((rawMax * 1.04) / 2, Math.abs(rawMin) * 1.04));
    return { yMin: -step, yMax: step * 2, ticks: [step * 2, step, 0, -step], zeroRow: 2 };
  }
  const step = niceStep(Math.max(rawMax * 1.04, (Math.abs(rawMin) * 1.04) / 2));
  return { yMin: -step * 2, yMax: step, ticks: [step, 0, -step, -step * 2], zeroRow: 1 };
}

export const pathOf = (values: Array<number | null>, x: (i: number) => number, y: (v: number) => number) => {
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
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clipId = useId();
  const { money, signed } = moneyOf(base);

  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
        setDragging(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  const visible = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)?.months;
    if (!months || points.length === 0) return points;
    const from = cutoff((points.at(-1) as Point).date, months);
    return points.filter((p) => p.date >= from);
  }, [points, range]);

  const colorOf = (id: string) =>
    id === ALL ? "var(--color-brand)" : id === GAIN ? "var(--color-good)" : (LINE_COLORS[symbols.indexOf(id) % LINE_COLORS.length] as string);
  const labelOf = (id: string) => (id === ALL ? "Portfolio" : id === GAIN ? "Gain" : id);
  const gainOf = (p: Point) => p.value - p.invested;

  const portfolioOnly = selected.length === 1 && selected[0] === ALL;
  const gainOnly = selected.length === 1 && selected[0] === GAIN;
  const compare = !portfolioOnly && !gainOnly;
  const n = visible.length;

  const lines = selected.map((id) => ({
    id,
    values: visible.map((p) => (id === ALL ? p.value : id === GAIN ? gainOf(p) : (p.by[id] ?? null))),
  }));
  const plottedValues = portfolioOnly
    ? visible.flatMap((p) => [p.value, p.invested])
    : lines.flatMap((l) => l.values.filter((v): v is number => v !== null));
  const { yMin, yMax, ticks: yTicks, zeroRow } = computeScale(plottedValues);
  const x = (i: number) => (n > 1 ? i / (n - 1) : 0) * 1000;
  const y = (v: number) => ((yMax - v) / (yMax - yMin)) * 300;
  const y0 = y(0);
  const crossesZero = yMin < 0 && yMax > 0;

  const at = hover !== null && hover < n ? hover : n - 1;
  const point = visible[at];
  const gain = point ? gainOf(point) : 0;
  const gainPct = point?.invested ? (gain / point.invested) * 100 : 0;
  const latest = visible.at(-1);
  const latestGain = latest ? gainOf(latest) : 0;
  const latestGainPct = latest?.invested ? (latestGain / latest.invested) * 100 : 0;
  const first = points[0];
  const since =
    range === "all"
      ? `Since your first trade, ${first ? monthYear(first.date) : ""}`
      : `Last ${range === "6m" ? "6 months" : "12 months"}`;
  const dateLabel = hover === null ? "Today" : fd(point?.date);
  const ticks = [0, 1, 2, 3].map((j) => visible[Math.round((j / 3) * (n - 1))]?.date).filter((d): d is string => Boolean(d));
  const axisPad = gainOnly || yMin < 0 ? "pl-[70px]" : "pl-[60px]";

  const hasRange = selection !== null && selection.start !== selection.end && selection.start < n && selection.end < n;
  const rangeFromIdx = hasRange ? Math.min(selection.start, selection.end) : 0;
  const rangeToIdx = hasRange ? Math.max(selection.start, selection.end) : 0;
  const fromPoint = hasRange ? visible[rangeFromIdx] : undefined;
  const toPoint = hasRange ? visible[rangeToIdx] : undefined;
  const xFrom = hasRange ? x(rangeFromIdx) : 0;
  const xTo = hasRange ? x(rangeToIdx) : 0;
  const midPct = hasRange ? (xFrom + xTo) / 20 : 50;

  const valDiff = fromPoint && toPoint ? toPoint.value - fromPoint.value : 0;
  const valDiffPct = fromPoint && fromPoint.value > 0 ? (valDiff / fromPoint.value) * 100 : null;
  const gainFrom = fromPoint ? gainOf(fromPoint) : 0;
  const gainTo = toPoint ? gainOf(toPoint) : 0;
  const gainDiff = gainTo - gainFrom;

  // Single-asset compare mode (e.g. only NVDA checked) also gets a rich floating delta pill.
  const singleLine = compare && lines.length === 1 ? lines[0] : null;
  const singleFrom = singleLine && hasRange ? (singleLine.values[rangeFromIdx] ?? null) : null;
  const singleTo = singleLine && hasRange ? (singleLine.values[rangeToIdx] ?? null) : null;
  const singleDiff = singleFrom !== null && singleTo !== null ? singleTo - singleFrom : null;
  const singleDiffPct = singleDiff !== null && singleFrom && singleFrom > 0 ? (singleDiff / singleFrom) * 100 : null;

  const rangeDiff = gainOnly ? gainDiff : portfolioOnly ? valDiff : singleDiff;
  const rangeDiffPct = portfolioOnly ? valDiffPct : singleLine ? singleDiffPct : null;
  const rangeUp = (rangeDiff ?? 0) >= 0;

  const formatTick = (v: number) => {
    if (v === 0) return money(0);
    if (v < 0) return `${MINUS}${money(v)}`;
    return gainOnly ? `+${money(v)}` : money(v);
  };

  const clearSelection = () => {
    setSelection(null);
    setDragging(false);
  };

  function toggle(id: string) {
    setHover(null);
    clearSelection();
    setSelected((current) => {
      if (id === GAIN && current.length === 1 && current[0] === ALL) return [GAIN];
      if (id === ALL && current.length === 1 && current[0] === GAIN) return [ALL];
      const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
      return next.length > 0 ? next : [ALL];
    });
  }

  const indexOf = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1))));
  };

  const valueLinePath = portfolioOnly && n >= 2 ? pathOf(visible.map((p) => p.value), x, y) : "";
  const valueAreaPath = portfolioOnly && n >= 2 ? `${valueLinePath}L1000,300L0,300Z` : "";
  const investedLinePath = portfolioOnly && n >= 2 ? pathOf(visible.map((p) => p.invested), x, y) : "";

  const gainValues = gainOnly ? visible.map(gainOf) : [];
  const gainLinePath = gainOnly ? pathOf(gainValues, x, y) : "";
  const gainAreaPath = gainOnly && n >= 2 ? `${gainLinePath}L${x(n - 1).toFixed(1)},${y0.toFixed(1)}L${x(0).toFixed(1)},${y0.toFixed(1)}Z` : "";

  return (
    <section aria-labelledby="growth" className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="growth" className="m-0 text-[17px] font-bold">Growth</h2>
          <span className="text-[13px] text-muted">{since}<span className="hidden sm:inline"> · Drag chart to compare</span></span>
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
                clearSelection();
              }}
              className={`h-7 rounded-lg px-3 text-[13px] font-semibold text-ink ${range === r.key ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)]" : ""}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label="Lines on the chart" className="flex flex-wrap gap-1.5">
        {[ALL, GAIN, ...symbols].map((id) => {
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
              <span className="text-xs text-muted">
                {hasRange && fromPoint && toPoint
                  ? `${fd(fromPoint.date)} – ${fd(toPoint.date)} · change`
                  : `${dateLabel} · ${selected.includes(GAIN) ? "value & gain" : "value"}`}
              </span>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {lines.map((line) => {
                  const isGain = line.id === GAIN;
                  if (hasRange) {
                    const v1 = line.values[rangeFromIdx] ?? null;
                    const v2 = line.values[rangeToIdx] ?? null;
                    const diff = v1 !== null && v2 !== null ? v2 - v1 : null;
                    const diffPct = !isGain && diff !== null && v1 !== null && v1 > 0 ? (diff / v1) * 100 : null;
                    return (
                      <span key={line.id} className="inline-flex items-center gap-2 text-sm">
                        <span aria-hidden="true" className="h-[3px] w-4 rounded-sm" style={{ background: colorOf(line.id) }} />
                        <span className="font-semibold">{labelOf(line.id)}</span>
                        <span className={`font-bold tabular-nums ${diff === null ? "text-muted" : diff < 0 ? "text-bad" : "text-good"}`}>
                          {diff === null ? "not held over range" : `${signed(diff)}${diffPct !== null ? ` (${pct1(diffPct)})` : ""}`}
                        </span>
                      </span>
                    );
                  }
                  const v = line.values[at] ?? null;
                  return (
                    <span key={line.id} className="inline-flex items-center gap-2 text-sm">
                      <span aria-hidden="true" className="h-[3px] w-4 rounded-sm" style={{ background: colorOf(line.id) }} />
                      <span className="font-semibold">{labelOf(line.id)}</span>
                      <span className={`font-bold tabular-nums ${v === null ? "text-muted" : isGain ? (v < 0 ? "text-bad" : "text-good") : ""}`}>
                        {v === null ? "not held yet" : isGain ? `${signed(v)} (${pct1(gainPct)})` : money(v)}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : gainOnly ? (
            hasRange && fromPoint && toPoint ? (
              <div className="flex flex-wrap items-end gap-7">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">{fd(fromPoint.date)} – {fd(toPoint.date)} · gain change</span>
                  <span className={`text-[22px] font-bold tracking-[-0.4px] tabular-nums ${gainDiff < 0 ? "text-bad" : "text-good"}`}>
                    {signed(gainDiff)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">{fd(fromPoint.date)}</span>
                  <span className={`text-[15px] font-semibold tabular-nums ${gainFrom < 0 ? "text-bad" : "text-good"}`}>{signed(gainFrom)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">{fd(toPoint.date)}</span>
                  <span className={`text-[15px] font-semibold tabular-nums ${gainTo < 0 ? "text-bad" : "text-good"}`}>{signed(gainTo)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">Value change</span>
                  <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{signed(valDiff)}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-7">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">{dateLabel} · gain</span>
                  <span className={`text-[22px] font-bold tracking-[-0.4px] tabular-nums ${gain < 0 ? "text-bad" : "text-good"}`}>
                    {signed(gain)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">Return</span>
                  <span className={`text-[15px] font-semibold tabular-nums ${gain < 0 ? "text-bad" : "text-good"}`}>
                    {pct1(gainPct)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">Value</span>
                  <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{money(point?.value)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">Invested</span>
                  <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{money(point?.invested)}</span>
                </div>
                <div className="ml-auto flex gap-3.5 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-[3px] w-3.5 rounded-sm bg-good" />Gain</span>
                  {crossesZero ? (
                    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-faint" />Break-even</span>
                  ) : null}
                </div>
              </div>
            )
          ) : hasRange && fromPoint && toPoint ? (
            <div className="flex flex-wrap items-end gap-7">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{fd(fromPoint.date)} – {fd(toPoint.date)}</span>
                <span className={`text-[22px] font-bold tracking-[-0.4px] tabular-nums ${valDiff < 0 ? "text-bad" : "text-good"}`}>
                  {signed(valDiff)}{valDiffPct !== null ? ` (${pct1(valDiffPct)})` : ""}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{fd(fromPoint.date)}</span>
                <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{money(fromPoint.value)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{fd(toPoint.date)}</span>
                <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{money(toPoint.value)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">Gain change</span>
                <span className={`text-[15px] font-semibold tabular-nums ${gainDiff < 0 ? "text-bad" : "text-good"}`}>{signed(gainDiff)}</span>
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
                  {signed(gain)} ({pct1(gainPct)})
                </span>
              </div>
              <div className="ml-auto flex gap-3.5 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-[3px] w-3.5 rounded-sm bg-brand" />Value</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-faint" />Invested</span>
              </div>
            </div>
          )}

          <div className={`relative h-[220px] select-none ${axisPad}`}>
            {yTicks.map((tick, row) => (
              <span key={row} className="absolute left-0 -translate-y-1/2 text-[11px] text-muted tabular-nums" style={{ top: `${(row / 3) * 100}%` }}>
                {formatTick(tick)}
              </span>
            ))}
            <div className="relative h-full">
              <div className={`absolute inset-x-0 top-0 border-t ${zeroRow === 0 ? "border-line" : "border-dashed border-line-soft"}`} />
              <div className={`absolute inset-x-0 top-1/3 border-t ${zeroRow === 1 ? "border-line" : "border-dashed border-line-soft"}`} />
              <div className={`absolute inset-x-0 top-2/3 border-t ${zeroRow === 2 ? "border-line" : "border-dashed border-line-soft"}`} />
              <div className="absolute inset-x-0 bottom-0 border-t border-line" />
              <svg
                viewBox="0 0 1000 300"
                preserveAspectRatio="none"
                role="img"
                aria-label={
                  gainOnly
                    ? `Portfolio gain ${signed(latestGain)} (${pct1(latestGainPct)})`
                    : `Portfolio value ${money((visible.at(-1) as Point).value)}, invested ${money((visible.at(-1) as Point).invested)}`
                }
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                <defs>
                  {gainOnly ? (
                    <>
                      <clipPath id={`${clipId}-pos`}>
                        <rect x="-20" y="-20" width="1040" height={y0 + 20} />
                      </clipPath>
                      <clipPath id={`${clipId}-neg`}>
                        <rect x="-20" y={y0} width="1040" height={320 - y0} />
                      </clipPath>
                    </>
                  ) : null}
                  {hasRange ? (
                    <clipPath id={`${clipId}-range`}>
                      <rect x={xFrom} y="-20" width={Math.max(1, xTo - xFrom)} height="340" />
                    </clipPath>
                  ) : null}
                </defs>

                {compare ? (
                  <>
                    {crossesZero ? (
                      <line x1="0" y1={y0} x2="1000" y2={y0} className="stroke-faint" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                    ) : null}
                    <g className={hasRange ? "opacity-35" : undefined}>
                      {lines.map((line) => (
                        <path key={line.id} d={pathOf(line.values, x, y)} fill="none" stroke={colorOf(line.id)} strokeWidth={line.id === ALL || line.id === GAIN ? 3 : 2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      ))}
                    </g>
                    {hasRange ? (
                      <g clipPath={`url(#${clipId}-range)`}>
                        <rect x={xFrom} y="0" width={Math.max(1, xTo - xFrom)} height="300" className="fill-brand/6" />
                        {lines.map((line) => (
                          <path key={line.id} d={pathOf(line.values, x, y)} fill="none" stroke={colorOf(line.id)} strokeWidth={line.id === ALL || line.id === GAIN ? 3 : 2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                        ))}
                      </g>
                    ) : null}
                  </>
                ) : gainOnly ? (
                  <>
                    {crossesZero ? (
                      <line x1="0" y1={y0} x2="1000" y2={y0} className="stroke-faint" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                    ) : null}
                    <g className={hasRange ? "opacity-35" : undefined}>
                      <g clipPath={`url(#${clipId}-pos)`}>
                        <path d={gainAreaPath} className="fill-good/12" />
                        <path d={gainLinePath} fill="none" className="stroke-good" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      </g>
                      <g clipPath={`url(#${clipId}-neg)`}>
                        <path d={gainAreaPath} className="fill-bad/12" />
                        <path d={gainLinePath} fill="none" className="stroke-bad" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      </g>
                    </g>
                    {hasRange ? (
                      <g clipPath={`url(#${clipId}-range)`}>
                        <path d={gainAreaPath} className={rangeUp ? "fill-good/14" : "fill-bad/14"} />
                        <path d={gainLinePath} fill="none" className={rangeUp ? "stroke-good" : "stroke-bad"} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      </g>
                    ) : null}
                  </>
                ) : (
                  <>
                    <g className={hasRange ? "opacity-35" : undefined}>
                      <path d={valueAreaPath} className="fill-brand/10" />
                      <path d={investedLinePath} fill="none" className="stroke-faint" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                      <path d={valueLinePath} fill="none" className="stroke-brand" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    </g>
                    {hasRange ? (
                      <g clipPath={`url(#${clipId}-range)`}>
                        <path d={valueAreaPath} className={rangeUp ? "fill-good/14" : "fill-bad/14"} />
                        <path d={investedLinePath} fill="none" className="stroke-faint" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                        <path d={valueLinePath} fill="none" className={rangeUp ? "stroke-good" : "stroke-bad"} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      </g>
                    ) : null}
                  </>
                )}
              </svg>

              {hasRange && fromPoint && toPoint ? (
                <>
                  <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink-2/60" style={{ left: `${xFrom / 10}%` }} />
                  <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink-2/60" style={{ left: `${xTo / 10}%` }} />
                  {compare ? (
                    lines.map((line) => {
                      const v1 = line.values[rangeFromIdx] ?? null;
                      const v2 = line.values[rangeToIdx] ?? null;
                      const color = colorOf(line.id);
                      return (
                        <span key={line.id}>
                          {v1 !== null ? (
                            <div
                              className="pointer-events-none absolute -mt-[4px] -ml-[4px] h-2 w-2 rounded-full shadow-[0_0_0_2.5px_var(--color-surface)]"
                              style={{ left: `${xFrom / 10}%`, top: `${y(v1) / 3}%`, background: color }}
                            />
                          ) : null}
                          {v2 !== null ? (
                            <div
                              className="pointer-events-none absolute -mt-[4px] -ml-[4px] h-2 w-2 rounded-full shadow-[0_0_0_2.5px_var(--color-surface)]"
                              style={{ left: `${xTo / 10}%`, top: `${y(v2) / 3}%`, background: color }}
                            />
                          ) : null}
                        </span>
                      );
                    })
                  ) : (
                    <>
                      <div
                        className={`pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_var(--color-surface)] ${rangeUp ? "bg-good" : "bg-bad"}`}
                        style={{ left: `${xFrom / 10}%`, top: `${y(gainOnly ? gainFrom : fromPoint.value) / 3}%` }}
                      />
                      <div
                        className={`pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_var(--color-surface)] ${rangeUp ? "bg-good" : "bg-bad"}`}
                        style={{ left: `${xTo / 10}%`, top: `${y(gainOnly ? gainTo : toPoint.value) / 3}%` }}
                      />
                    </>
                  )}
                </>
              ) : hover !== null && point ? (
                <>
                  <div className="pointer-events-none absolute inset-y-0 border-l border-line" style={{ left: `${x(at) / 10}%` }} />
                  {portfolioOnly ? (
                    <div
                      className="pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full bg-brand shadow-[0_0_0_3px_var(--color-surface)]"
                      style={{ left: `${x(at) / 10}%`, top: `${y(point.value) / 3}%` }}
                    />
                  ) : gainOnly ? (
                    <div
                      className={`pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_var(--color-surface)] ${gain < 0 ? "bg-bad" : "bg-good"}`}
                      style={{ left: `${x(at) / 10}%`, top: `${y(gain) / 3}%` }}
                    />
                  ) : null}
                </>
              ) : null}

              <div
                aria-hidden="true"
                className={`absolute inset-0 touch-pan-y ${dragging ? "cursor-ew-resize" : "cursor-crosshair"}`}
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse" && e.button !== 0) return;
                  const idx = indexOf(e);
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(true);
                  setHover(idx);
                  setSelection({ start: idx, end: idx });
                }}
                onPointerMove={(e) => {
                  const idx = indexOf(e);
                  if (dragging) {
                    setSelection((prev) => (prev ? { ...prev, end: idx } : { start: idx, end: idx }));
                    setHover(idx);
                  } else if (!hasRange) {
                    setHover(idx);
                  }
                }}
                onPointerUp={() => {
                  if (!dragging) return;
                  setDragging(false);
                  setSelection((prev) => (prev && prev.start !== prev.end ? prev : null));
                }}
                onPointerCancel={() => {
                  if (!dragging) return;
                  setDragging(false);
                  setSelection(null);
                }}
                onPointerLeave={() => {
                  if (!dragging) setHover(null);
                }}
              />

              {hasRange && fromPoint && toPoint ? (
                <div
                  className="pointer-events-none absolute top-1 z-10 flex items-center gap-2 rounded-xl border border-line bg-surface/95 px-3 py-1.5 text-xs whitespace-nowrap shadow-[0_6px_20px_rgba(11,31,58,0.14)] backdrop-blur-xs"
                  style={{ left: `${midPct}%`, transform: `translateX(-${midPct}%)` }}
                >
                  {rangeDiff !== null ? (
                    <span className={`font-semibold tabular-nums ${rangeUp ? "text-good" : "text-bad"}`}>
                      {signed(rangeDiff)}{rangeDiffPct !== null ? ` (${pct1(rangeDiffPct)})` : ""} {rangeUp ? "↑" : "↓"}
                    </span>
                  ) : null}
                  <span className="text-muted">{fd(fromPoint.date)} – {fd(toPoint.date)}</span>
                  {!dragging ? (
                    <button
                      type="button"
                      aria-label="Clear range selection"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearSelection();
                        setHover(null);
                      }}
                      className="pointer-events-auto -mr-1 ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className={`flex justify-between ${axisPad} text-[11px] text-muted`}>
            {ticks.map((date, i) => <span key={`${date}${i}`}>{monthYear(date)}</span>)}
          </div>
        </>
      )}
    </section>
  );
}

