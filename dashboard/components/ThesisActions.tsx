"use client";
import { useState, useTransition } from "react";
import { markReviewedAction } from "@/app/(app)/actions";
import { ThesisForm, type ThesisValues } from "./forms/ThesisForm";
import { primaryButton, softButton } from "./PageActions";
import { useToast } from "./Toast";

export function ThesisActions({
  symbol,
  currency,
  values,
  canReview,
}: {
  symbol: string;
  currency: string;
  values: ThesisValues;
  canReview: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const { say, toast } = useToast();
  const exists = values.id !== null;

  return (
    <div className="flex flex-wrap gap-2">
      {canReview ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await markReviewedAction(values.id as number, symbol);
              say(res.ok ? res.message : res.error);
            })
          }
          className={`${primaryButton} disabled:opacity-60`}
        >
          Mark reviewed · holds
        </button>
      ) : null}
      <button type="button" onClick={() => setEditing(true)} className={exists ? softButton : primaryButton}>
        {exists ? "Edit" : "Write thesis"}
      </button>
      {editing ? (
        <ThesisForm
          symbol={symbol}
          currency={currency}
          values={values}
          onClose={() => setEditing(false)}
          onDone={(message) => {
            setEditing(false);
            say(message);
          }}
        />
      ) : null}
      {toast}
    </div>
  );
}
