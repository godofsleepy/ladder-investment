"use client";
import Link from "next/link";
import { useState } from "react";
import { CLASSES, MACRO_BADGE, moneyOf, nat, pct1, qf, type Money } from "@/lib/format";
import { positionContext } from "@/lib/context";
import type { Position } from "@/lib/ladder";
import { CopyContext } from "./CopyContext";
import { Badge } from "./ui";

const GRID = "grid grid-cols-[minmax(130px,2fr)_minmax(120px,1.4fr)_repeat(2,minmax(84px,1fr))_minmax(92px,1fr)_92px] gap-2.5";

export function HoldingsTable({ positions, base }: { positions: Position[]; base: Money }) {
  const [filter, setFilter] = useState("all");
  const { money, signed } = moneyOf(base);
  const held = new Set(positions.map((p) => p.class));
  const filters = [
    { key: "all", label: "All" },
    ...CLASSES.filter((c) => c.key !== "other" || held.has("other")),
  ];
  const rows = positions.filter((p) => filter === "all" || p.class === filter);

  return (
    <section aria-labelledby="holdings" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 id="holdings" className="m-0 text-[17px] font-bold">Holdings</h2>
        <div role="group" aria-label="Asset class" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`min-h-11 rounded-full px-3 text-[13px] font-semibold sm:min-h-[30px] ${filter === f.key ? "bg-ink text-page" : "bg-fill text-ink-2"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className={`${GRID} border-t border-line-soft px-5 py-2 text-right text-xs font-semibold text-muted`}>
            <span className="text-left">Asset</span>
            <span>Position</span>
            <span>Price</span>
            <span>Value</span>
            <span>P&amp;L</span>
            <span>Macro view</span>
          </div>
          {rows.length === 0 ? (
            <p className="m-0 border-t border-line-soft px-5 py-4 text-sm text-muted">Nothing in this class yet.</p>
          ) : (
            rows.map((p) => {
              const macro = p.macro ? MACRO_BADGE[p.macro.state] : null;
              const loss = p.unrealized_idr !== null && Number(p.unrealized_idr) < 0;
              return (
                <div key={p.symbol} className={`relative ${GRID} items-center border-t border-line-soft px-5 py-3 text-right text-sm text-ink tabular-nums hover:bg-hover hover:text-ink`}>
                  <span className="flex min-w-0 flex-col text-left">
                    <span className="flex items-center gap-2">
                      <Link href={`/assets/${p.symbol}`} className="font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:text-ink">{p.symbol}</Link>
                      <CopyContext label={`${p.symbol} holding`} text={positionContext(p, base)} />
                    </span>
                    {p.name !== p.symbol ? <span className="truncate text-xs text-muted">{p.name}</span> : null}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-ink-2">{qf(p.qty, p.symbol, p.class)}</span>
                    <span className="text-xs text-muted">avg {p.avg_cost ? nat(p.price_currency, p.avg_cost) : nat("IDR", p.avg_cost_idr)}</span>
                  </span>
                  <span>{nat(p.price_currency, p.price)}</span>
                  <span className="font-semibold">{money(p.value_idr)}</span>
                  <span className={`flex flex-col ${loss ? "text-bad" : "text-good"}`}>
                    <span className="font-semibold">{signed(p.unrealized_idr)}</span>
                    <span className="text-xs">{pct1(p.unrealized_pct)}</span>
                  </span>
                  <span className="flex justify-end">
                    <Badge className={macro?.className ?? "bg-fill text-ink-2"}>{p.macro?.short_name ?? "None"}</Badge>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
