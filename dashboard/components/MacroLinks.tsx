"use client";
import { useState, useTransition } from "react";
import { linkMacroAssetAction, unlinkMacroAssetAction } from "@/app/(app)/actions";
import { useToast } from "./Toast";

const smallButton = "min-h-11 shrink-0 rounded-lg bg-fill px-2.5 text-xs font-semibold text-ink-2 hover:bg-fill-strong disabled:opacity-60 sm:min-h-8";

/** Picks one of your assets and links it to the view. */
export function LinkAsset({ viewId, options }: { viewId: number; options: Array<{ symbol: string; name: string }> }) {
  const [symbol, setSymbol] = useState("");
  const [pending, start] = useTransition();
  const { say, toast } = useToast();
  if (options.length === 0) return <p className="m-0 text-[13px] text-muted">Every asset Ladder knows is already linked.</p>;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!symbol) return;
        start(async () => {
          const res = await linkMacroAssetAction(viewId, symbol);
          say(res.ok ? res.message : res.error);
          if (res.ok) setSymbol("");
        });
      }}
    >
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        Link an asset
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-[38px] max-w-[60vw] rounded-[10px] border border-line bg-surface px-2.5 text-sm text-ink">
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.symbol} value={o.symbol}>{o.name !== o.symbol ? `${o.symbol} · ${o.name}` : o.symbol}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={!symbol || pending} className="h-[38px] rounded-[10px] bg-brand px-3.5 text-sm font-semibold text-on-brand hover:bg-brand-dark disabled:opacity-50">
        Link
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
