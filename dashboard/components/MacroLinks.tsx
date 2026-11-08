"use client";
import { useState, useTransition } from "react";
import { linkMacroAssetAction, unlinkMacroAssetAction } from "@/app/(app)/actions";
import { useToast } from "./Toast";

const smallButton = "min-h-11 shrink-0 rounded-lg bg-fill px-2.5 text-xs font-semibold text-ink-2 hover:bg-fill-strong disabled:opacity-60 sm:min-h-8";

const TYPES = [
  { key: "", label: "Type: auto" },
  { key: "us_stock", label: "US stock" },
  { key: "idx_stock", label: "IDX stock" },
  { key: "crypto", label: "Crypto" },
  { key: "gold", label: "Gold" },
  { key: "bond", label: "Bond" },
  { key: "other", label: "Other" },
];

/** Links any ticker, held or not. Known assets are suggested; a new one is added to Ladder. */
export function LinkAsset({ viewId, options }: { viewId: number; options: Array<{ symbol: string; name: string }> }) {
  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState("");
  const [pending, start] = useTransition();
  const { say, toast } = useToast();
  const listId = `link-assets-${viewId}`;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!symbol.trim()) return;
        start(async () => {
          const res = await linkMacroAssetAction(viewId, symbol, type || undefined);
          say(res.ok ? res.message : res.error);
          if (res.ok) {
            setSymbol("");
            setType("");
          }
        });
      }}
    >
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        Link a ticker
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          list={listId}
          placeholder="NVDA, TSM, BBRI.JK"
          autoComplete="off"
          spellCheck={false}
          className="h-[38px] w-[150px] rounded-[10px] border border-line bg-surface px-2.5 text-sm text-ink uppercase placeholder:normal-case"
        />
      </label>
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.symbol} value={o.symbol}>{o.name !== o.symbol ? o.name : undefined}</option>
        ))}
      </datalist>
      <label className="sr-only" htmlFor={`${listId}-type`}>Type, for a ticker new to Ladder</label>
      <select id={`${listId}-type`} value={type} onChange={(e) => setType(e.target.value)} className="h-[38px] rounded-[10px] border border-line bg-surface px-2.5 text-sm text-ink">
        {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <button type="submit" disabled={!symbol.trim() || pending} className="h-[38px] rounded-[10px] bg-brand px-3.5 text-sm font-semibold text-on-brand hover:bg-brand-dark disabled:opacity-50">
        {pending ? "Linking…" : "Link"}
      </button>
      {toast}
    </form>
  );
}

export function UnlinkAsset({ viewId, symbol }: { viewId: number; symbol: string }) {
  const [pending, start] = useTransition();
  const { say, toast } = useToast();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-label={`Unlink ${symbol}`}
        onClick={() =>
          start(async () => {
            const res = await unlinkMacroAssetAction(viewId, symbol);
            say(res.ok ? res.message : res.error);
          })
        }
        className={`relative z-10 ${smallButton}`}
      >
        Unlink
      </button>
      {toast}
    </>
  );
}
