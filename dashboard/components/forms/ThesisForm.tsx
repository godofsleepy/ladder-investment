"use client";
import { useState, useTransition } from "react";
import { saveThesisAction } from "@/app/(app)/actions";
import { Choice, fieldInput, fieldLabel, FormDialog } from "./FormDialog";

type Every = "monthly" | "quarterly" | "half-yearly";

export interface ThesisValues {
  id: number | null;
  statement: string;
  invalidate: string;
  alertBelow: string;
  every: Every;
}

export function ThesisForm({
  symbol,
  currency,
  values,
  onClose,
  onDone,
}: {
  symbol: string;
  currency: string;
  values: ThesisValues;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [statement, setStatement] = useState(values.statement);
  const [invalidate, setInvalidate] = useState(values.invalidate);
  const [alertBelow, setAlertBelow] = useState(values.alertBelow);
  const [every, setEvery] = useState(values.every);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const save = () =>
    startSave(async () => {
      const below = Number.parseFloat(alertBelow.replace(/,/g, ""));
      const res = await saveThesisAction({
        symbol,
        thesisId: values.id,
        statement,
        invalidate,
        alertBelow: Number.isFinite(below) ? below : null,
        every,
      });
      if (res.ok) onDone(res.message);
      else setProblem(res.error);
    });

  return (
    <FormDialog title={`Thesis · ${symbol}`} canSave={Boolean(statement.trim())} saving={saving} onSave={save} onClose={onClose}>
      <label className={fieldLabel}>
        Why I own it
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          rows={3}
          maxLength={200}
          placeholder="One sentence you could say out loud"
          className="box-border w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 text-sm leading-normal font-normal text-ink"
        />
      </label>
      <label className={fieldLabel}>
        Invalidate if
        <input value={invalidate} onChange={(e) => setInvalidate(e.target.value)} placeholder="What would prove this wrong" className={fieldInput} />
      </label>
      <label className={fieldLabel}>
        Alert if price below ({currency}, optional)
        <input inputMode="decimal" value={alertBelow} onChange={(e) => setAlertBelow(e.target.value)} className={`${fieldInput} text-right`} />
      </label>
      <Choice
        label="Review every"
        value={every}
        options={[{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "half-yearly", label: "Half-yearly" }]}
        onPick={setEvery}
      />
      {problem ? <span role="alert" className="text-[13px] font-semibold text-bad-strong">{problem}</span> : null}
    </FormDialog>
  );
}
