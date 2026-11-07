"use client";
import { useRouter } from "next/navigation";

const SIDES = [
  { key: "all", label: "All" },
  { key: "buy", label: "Buys" },
  { key: "sell", label: "Sells" },
  { key: "dividend", label: "Dividends" },
  { key: "other", label: "Deposits & fees" },
];

export function TradeFilters({ side, symbol, symbols, summary }: { side: string; symbol: string | null; symbols: string[]; summary: string }) {
  const router = useRouter();
  const go = (nextSide: string, nextSymbol: string | null) => {
    const query = new URLSearchParams();
    if (nextSide !== "all") query.set("side", nextSide);
    if (nextSymbol) query.set("asset", nextSymbol);
    const text = query.toString();
    router.replace(text ? `/trades?${text}` : "/trades", { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Side" className="flex flex-wrap gap-1 rounded-[11px] bg-fill p-[3px]">
        {SIDES.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={side === s.key}
            onClick={() => go(s.key, symbol)}
            className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold text-ink sm:min-h-8 ${side === s.key ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)]" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        Asset
        <select
          value={symbol ?? ""}
          onChange={(e) => go(side, e.target.value || null)}
          className="h-[38px] rounded-[10px] border border-line bg-surface px-2.5 text-sm text-ink"
        >
          <option value="">All assets</option>
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span className="text-[13px] text-muted tabular-nums sm:ml-auto">{summary}</span>
    </div>
  );
}
