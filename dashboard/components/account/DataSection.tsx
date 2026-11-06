"use client";
import { useState, useTransition } from "react";
import { deleteAccount } from "@/app/(app)/account/actions";

export function DataSection() {
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = text.trim() === "DELETE";

  return (
    <section aria-labelledby="data" className="card flex flex-col gap-3.5 p-5">
      <h2 id="data" className="m-0 text-[17px] font-bold">Your data</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Export</span>
          <span className="text-[13px] text-muted">Trades, holdings, theses, watchlist and journal as CSV files.</span>
        </span>
        <a href="/account/export" className="flex min-h-11 items-center rounded-[10px] border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-hover hover:text-ink sm:min-h-9">Export CSV</a>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3.5">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-bad">Delete account</span>
          <span className="text-[13px] text-muted">Removes your account and every record in it. This cannot be undone.</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setText("");
          }}
          className="min-h-11 rounded-[10px] border border-bad bg-surface px-3.5 text-[13px] font-semibold text-bad sm:min-h-9"
        >
          Delete account
        </button>
      </div>
      {confirming ? (
        <div role="alertdialog" aria-label="Confirm delete" className="flex flex-col gap-3 rounded-xl bg-bad/8 p-3.5">
          <span className="text-sm">Type <b>DELETE</b> to confirm. Export your data first if you want a copy.</span>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Type DELETE to confirm"
              className="input h-[38px] min-w-[160px] flex-1"
            />
            <button type="button" onClick={() => setConfirming(false)} className="h-[38px] rounded-[10px] bg-fill px-3.5 text-[13px] font-semibold text-ink">Cancel</button>
            <button
              type="button"
              disabled={!ready || pending}
              onClick={() => startTransition(() => deleteAccount(text))}
              className="h-[38px] rounded-[10px] bg-bad px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              Delete forever
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
