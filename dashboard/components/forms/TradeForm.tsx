"use client";
import { useEffect, useState, useTransition } from "react";
import { logTradeAction, previewAction } from "@/app/(app)/actions";
import { MINUS, nat, qf, unitOf } from "@/lib/format";
import type { AssetOption } from "@/lib/ladder";
import { Choice, fieldInput, fieldLabel, FormDialog } from "./FormDialog";

const NEW = "__new";

const NEW_CLASSES = [
  { value: "idx_stock", label: "Indonesian stock" },
  { value: "us_stock", label: "US stock" },
  { value: "crypto", label: "Crypto" },
  { value: "gold", label: "Gold" },
  { value: "bond", label: "Bond" },
  { value: "other", label: "Other" },
] as const;

type NewClass = (typeof NEW_CLASSES)[number]["value"];
type Preview = Awaited<ReturnType<typeof previewAction>>["preview"];

const toNumber = (value: string) => {
  const n = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
};

export function TradeForm({
  assets,
  defaultSymbol,
  today,
  onClose,
  onDone,
}: {
  assets: AssetOption[];
  defaultSymbol?: string;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const first = defaultSymbol ?? assets[0]?.symbol ?? NEW;
  const [choice, setChoice] = useState(first);
  const [newSymbol, setNewSymbol] = useState("");
  const [newClass, setNewClass] = useState<NewClass>("idx_stock");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(assets.find((a) => a.symbol === first)?.price ?? "");
  const [date, setDate] = useState(today);
  const [fee, setFee] = useState("");
  const [preview, setPreview] = useState<Preview>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const isNew = choice === NEW;
  const asset = assets.find((a) => a.symbol === choice);
  const symbol = isNew ? newSymbol.trim().toUpperCase() : choice;
  const cls = isNew ? newClass : (asset?.class ?? "other");
  const currency = isNew ? (newClass === "us_stock" ? "USD" : "IDR") : (asset?.currency ?? "IDR");
  const q = toNumber(qty);
  const p = toNumber(price);
  const f = fee ? toNumber(fee) : 0;
  const filled = q > 0 && p > 0 && Boolean(symbol) && !Number.isNaN(f);

  useEffect(() => {
    setProblem(null);
    if (!filled) {
      setPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const res = await previewAction({ symbol, side, qty: q, price: p, fee: f });
      if (!live) return;
      setPreview(res.preview);
      setProblem(res.error);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [filled, symbol, side, q, p, f]);

  const save = () =>
    startSave(async () => {
      const res = await logTradeAction({ symbol, side, qty: q, price: p, fee: f, date, assetClass: isNew ? newClass : undefined });
      if (res.ok) onDone(res.message);
      else setProblem(res.error);
    });

  const rows: Array<{ k: string; v: string; tone?: string }> =
    side === "buy"
      ? [
          { k: "Total", v: preview?.side === "buy" ? nat(currency, preview.total) : "Not yet" },
          { k: "New quantity", v: preview ? qf(preview.qty, symbol, cls) : "Not yet" },
          { k: "New avg cost", v: preview?.side === "buy" ? nat(currency, preview.avg) : "Not yet" },
        ]
      : [
          { k: "Proceeds", v: preview?.side === "sell" ? nat(currency, preview.proceeds) : "Not yet" },
          { k: "Quantity left", v: preview ? qf(preview.qty, symbol, cls) : "Not yet" },
          {
            k: "Realised P&L",
            v: preview?.side === "sell" ? `${Number(preview.realized) < 0 ? MINUS : "+"}${nat(currency, Math.abs(Number(preview.realized)))}` : "Not yet",
            tone: preview?.side === "sell" ? (Number(preview.realized) < 0 ? "text-bad" : "text-good") : undefined,
          },
        ];

  return (
    <FormDialog title="Log trade" canSave={filled && !problem && Boolean(preview)} saving={saving} onSave={save} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className={fieldLabel}>
          Asset
          <select
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setPrice(assets.find((a) => a.symbol === e.target.value)?.price ?? "");
            }}
            className={fieldInput}
          >
            {assets.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
            <option value={NEW}>New asset</option>
          </select>
        </label>
        <Choice label="Side" value={side} options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} onPick={setSide} />
        {isNew ? (
          <>
            <label className={fieldLabel}>
              Ticker
              <input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="BBRI" autoCapitalize="characters" className={fieldInput} />
            </label>
            <label className={fieldLabel}>
              Type
              <select value={newClass} onChange={(e) => setNewClass(e.target.value as NewClass)} className={fieldInput}>
                {NEW_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          </>
        ) : null}
        <label className={fieldLabel}>
          Quantity ({unitOf(symbol || "units", cls)})
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={`${fieldInput} text-right tabular-nums`} />
        </label>
        <label className={fieldLabel}>
          Price ({currency})
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={`${fieldInput} text-right tabular-nums`} />
        </label>
        <label className={fieldLabel}>
          Date
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={fieldInput} />
        </label>
        <label className={fieldLabel}>
          Fee ({currency})
          <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" className={`${fieldInput} text-right tabular-nums`} />
        </label>
      </div>
      <div className="flex flex-col gap-2 rounded-[14px] bg-fill px-3.5 py-3">
        {rows.map((row) => (
          <div key={row.k} className="flex justify-between gap-3 text-sm">
            <span className="text-ink-2">{row.k}</span>
            <span className={`font-semibold tabular-nums ${row.tone ?? ""}`}>{row.v}</span>
          </div>
        ))}
      </div>
      {problem ? <span role="alert" className="text-[13px] font-semibold text-bad-strong">{problem}</span> : null}
      <span className="text-xs text-muted">Avg cost and P&amp;L are computed by Ladder.</span>
    </FormDialog>
  );
}
