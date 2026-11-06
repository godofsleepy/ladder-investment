"use client";
import { useState, useTransition } from "react";
import { addNoteAction } from "@/app/(app)/actions";
import type { AssetOption } from "@/lib/ladder";
import { fieldInput, fieldLabel, FormDialog } from "./FormDialog";

export function NoteForm({
  assets,
  defaultSymbol,
  onClose,
  onDone,
}: {
  assets: AssetOption[];
  defaultSymbol?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [symbol, setSymbol] = useState(defaultSymbol ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const save = () =>
    startSave(async () => {
      const res = await addNoteAction({ text, symbol });
      if (res.ok) onDone(res.message);
      else setProblem(res.error);
    });

  return (
    <FormDialog title="New note" canSave={Boolean(text.trim())} saving={saving} onSave={save} onClose={onClose}>
      <label className={fieldLabel}>
        Note
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="What happened, and what you decided"
          className="box-border w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 text-sm leading-normal font-normal text-ink"
        />
      </label>
      <label className={fieldLabel}>
        Holding
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={fieldInput}>
          <option value="">None</option>
          {assets.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
        </select>
      </label>
      {problem ? <span role="alert" className="text-[13px] font-semibold text-bad-strong">{problem}</span> : null}
    </FormDialog>
  );
}
