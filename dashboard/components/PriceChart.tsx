"use client";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { loadPriceHistoryAction } from "@/app/(app)/actions";
import { fd, MINUS, monthYear, nat, pct1 } from "@/lib/format";
import { cutoff, pathOf } from "./GrowthChart";
import { softButton } from "./PageActions";

interface Point {
  date: string;
  close: number;
}

type Range = "1m" | "6m" | "1y" | "5y";

const RANGES: Array<{ key: Range; label: string; months: number; since: string }> = [
  { key: "1m", label: "1M", months: 1, since: "Last month" },
  { key: "6m", label: "6M", months: 6, since: "Last 6 months" },
  { key: "1y", label: "1Y", months: 12, since: "Last 12 months" },
  { key: "5y", label: "5Y", months: 60, since: "Last 5 years" },
];

export function PriceChart({ symbol, currency, points, needsHistory }: { symbol: string; currency: string; points: Point[]; needsHistory: boolean }) {
  const [range, setRange] = useState<Range>("1y");
  const [hover, setHover] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const asked = useRef(false);
  const clipId = useId();

  const load = () => {
    setError(null);
    start(async () => {
      const res = await loadPriceHistoryAction(symbol);
      if (!res.ok) setError(res.error);
    });
  };

  // The first visit fetches the history, so a watchlist asset has a chart without a refresh.
  useEffect(() => {
    if (!needsHistory || asked.current) return;
    asked.current = true;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsHistory]);

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

  const active = RANGES.find((r) => r.key === range) ?? (RANGES[2] as (typeof RANGES)[number]);
  const visible = useMemo(() => {
    const last = points.at(-1);
    if (!last) return points;
    const from = cutoff(last.date, active.months);
    return points.filter((p) => p.date >= from);
  }, [points, active.months]);

  const n = visible.length;
  const latest = visible.at(-1);
  const start0 = visible[0];
  const at = hover !== null && hover < n ? hover : n - 1;
  const point = visible[at];
  const closes = visible.map((p) => p.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const pad = (high - low || high || 1) * 0.06;
  const floor = Math.max(0, low - pad);
  const top = high + pad;
  const x = (i: number) => (n > 1 ? i / (n - 1) : 0) * 1000;
  const y = (v: number) => 300 - ((v - floor) / (top - floor)) * 300;
  const change = point && start0 ? point.close - start0.close : 0;
  const changePct = start0 && start0.close > 0 ? (change / start0.close) * 100 : 0;
  const ticks = [0, 1, 2, 3].map((j) => visible[Math.round((j / 3) * (n - 1))]?.date).filter((d): d is string => Boolean(d));

  const hasRange = selection !== null && selection.start !== selection.end && selection.start < n && selection.end < n;
  const rangeFromIdx = hasRange ? Math.min(selection.start, selection.end) : 0;
  const rangeToIdx = hasRange ? Math.max(selection.start, selection.end) : 0;
  const fromPoint = hasRange ? visible[rangeFromIdx] : undefined;
  const toPoint = hasRange ? visible[rangeToIdx] : undefined;
  const rangeDiff = fromPoint && toPoint ? toPoint.close - fromPoint.close : 0;
  const rangePct = fromPoint && fromPoint.close > 0 ? (rangeDiff / fromPoint.close) * 100 : 0;
  const rangeUp = rangeDiff >= 0;
  const xFrom = hasRange ? x(rangeFromIdx) : 0;
  const xTo = hasRange ? x(rangeToIdx) : 0;
  const midPct = hasRange ? (xFrom + xTo) / 20 : 50;

  const linePath = n >= 2 ? pathOf(closes, x, y) : "";
  const areaPath = n >= 2 ? `${linePath}L1000,300L0,300Z` : "";

  const indexOf = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1))));
  };

  return (
    <section aria-labelledby="price" className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="price" className="m-0 text-[17px] font-bold">Price</h2>
          <span className="text-[13px] text-muted">{active.since}<span className="hidden sm:inline"> · Drag chart to compare</span></span>
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
                setSelection(null);
                setDragging(false);
              }}
              className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold text-ink sm:min-h-7 ${range === r.key ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)]" : ""}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {n < 2 ? (
        <p role="status" className="m-0 text-sm text-ink-2">{loading ? "Fetching price history…" : error ? "" : "No price history yet."}</p>
      ) : (
        <>
          {hasRange && fromPoint && toPoint ? (
            <div className="flex flex-wrap items-end gap-7">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{fd(fromPoint.date)} – {fd(toPoint.date)}</span>
                <span className={`text-[22px] font-bold tracking-[-0.4px] tabular-nums ${rangeUp ? "text-good" : "text-bad"}`}>
                  {rangeUp ? "+" : MINUS}{nat(currency, Math.abs(rangeDiff))} ({pct1(rangePct)})
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{fd(fromPoint.date)}</span>
                <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{nat(currency, fromPoint.close)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{fd(toPoint.date)}</span>
                <span className="text-[15px] font-semibold text-ink-2 tabular-nums">{nat(currency, toPoint.close)}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-7">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{hover === null ? `Current · ${fd(point?.date)}` : fd(point?.date)}</span>
                <span className="text-[22px] font-bold tracking-[-0.4px] tabular-nums">{nat(currency, point?.close)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">Since {fd(start0?.date)}</span>
                <span className={`text-[15px] font-semibold tabular-nums ${change < 0 ? "text-bad" : "text-good"}`}>
                  {change < 0 ? MINUS : "+"}{nat(currency, Math.abs(change))} ({pct1(changePct)})
                </span>
              </div>
              <div className="ml-auto flex gap-3.5 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-[3px] w-3.5 rounded-sm bg-brand" />Close</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-faint" />Current</span>
              </div>
            </div>
          )}

          <div className="relative h-[220px] pl-[92px] select-none">
            {[3, 2, 1, 0].map((j, row) => (
              <span key={j} className="absolute left-0 -translate-y-1/2 text-[11px] text-muted tabular-nums" style={{ top: `${(row / 3) * 100}%` }}>
                {nat(currency, floor + ((top - floor) * j) / 3)}
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
                aria-label={`${symbol} price from ${nat(currency, start0?.close)} on ${fd(start0?.date)} to ${nat(currency, latest?.close)} on ${fd(latest?.date)}`}
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                {hasRange ? (
                  <defs>
                    <clipPath id={`${clipId}-range`}>
                      <rect x={xFrom} y="-20" width={Math.max(1, xTo - xFrom)} height="340" />
                    </clipPath>
                  </defs>
                ) : null}
                <g className={hasRange ? "opacity-35" : undefined}>
                  <path d={areaPath} className="fill-brand/10" />
                  <path d={`M0,${y(latest?.close ?? 0).toFixed(1)}L1000,${y(latest?.close ?? 0).toFixed(1)}`} fill="none" className="stroke-faint" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                  <path d={linePath} fill="none" className="stroke-brand" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
                {hasRange ? (
                  <g clipPath={`url(#${clipId}-range)`}>
                    <path d={areaPath} className={rangeUp ? "fill-good/14" : "fill-bad/14"} />
                    <path d={linePath} fill="none" className={rangeUp ? "stroke-good" : "stroke-bad"} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </g>
                ) : null}
              </svg>

              {hasRange && fromPoint && toPoint ? (
                <>
                  <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink-2/60" style={{ left: `${xFrom / 10}%` }} />
                  <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink-2/60" style={{ left: `${xTo / 10}%` }} />
                  <div
                    className={`pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_var(--color-surface)] ${rangeUp ? "bg-good" : "bg-bad"}`}
                    style={{ left: `${xFrom / 10}%`, top: `${y(fromPoint.close) / 3}%` }}
                  />
                  <div
                    className={`pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_var(--color-surface)] ${rangeUp ? "bg-good" : "bg-bad"}`}
                    style={{ left: `${xTo / 10}%`, top: `${y(toPoint.close) / 3}%` }}
                  />
                </>
              ) : point ? (
                <>
                  {hover !== null ? <div className="pointer-events-none absolute inset-y-0 border-l border-line" style={{ left: `${x(at) / 10}%` }} /> : null}
                  <div className="pointer-events-none absolute -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full bg-brand shadow-[0_0_0_3px_var(--color-surface)]" style={{ left: `${x(at) / 10}%`, top: `${y(point.close) / 3}%` }} />
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
                  <span className={`font-semibold tabular-nums ${rangeUp ? "text-good" : "text-bad"}`}>
                    {rangeUp ? "+" : MINUS}{nat(currency, Math.abs(rangeDiff))} ({pct1(rangePct)}) {rangeUp ? "↑" : "↓"}
                  </span>
                  <span className="text-muted">{fd(fromPoint.date)} – {fd(toPoint.date)}</span>
                  {!dragging ? (
                    <button
                      type="button"
                      aria-label="Clear range selection"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelection(null);
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
          <div className="flex justify-between pl-[92px] text-[11px] text-muted">
            {ticks.map((date, i) => <span key={`${date}${i}`}>{monthYear(date)}</span>)}
          </div>
        </>
      )}

      {error ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="m-0 text-sm text-ink-2">{error}</p>
          <button type="button" disabled={loading} onClick={load} className={`${softButton} disabled:opacity-60`}>Try again</button>
        </div>
      ) : null}
    </section>
  );
}
