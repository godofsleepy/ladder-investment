"use client";
import { useState } from "react";
import type { AssetOption } from "@/lib/ladder";
import { NoteForm } from "./forms/NoteForm";
import { TradeForm } from "./forms/TradeForm";
import { useToast } from "./Toast";

export const primaryButton = "h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-dark";
export const softButton = "h-10 rounded-xl bg-fill px-4 text-sm font-semibold text-ink hover:bg-fill-strong";

export function PageActions({
  assets,
  today,
  defaultSymbol,
  tradeDefault,
  only,
}: {
  assets: AssetOption[];
  today: string;
  /** On an asset's page: both forms start on that asset. */
  defaultSymbol?: string;
  /** Elsewhere: the trade form starts on your biggest holding, and a note starts untagged. */
  tradeDefault?: string;
  only?: "note";
}) {
  const [open, setOpen] = useState<"trade" | "note" | null>(null);
  const { say, toast } = useToast();
  const done = (message: string) => {
    setOpen(null);
    say(message);
  };

  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => setOpen("note")} className={only ? primaryButton : softButton}>Add note</button>
      {only ? null : <button type="button" onClick={() => setOpen("trade")} className={primaryButton}>Log trade</button>}
      {open === "trade" ? <TradeForm assets={assets} defaultSymbol={defaultSymbol ?? tradeDefault} today={today} onClose={() => setOpen(null)} onDone={done} /> : null}
      {open === "note" ? <NoteForm assets={assets} defaultSymbol={defaultSymbol} onClose={() => setOpen(null)} onDone={done} /> : null}
      {toast}
    </div>
  );
}
