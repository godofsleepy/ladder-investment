"use client";
import { useTransition } from "react";
import { refreshAction } from "@/app/(app)/actions";
import { useToast } from "./Toast";

export function PricesCard({ refreshed, fx }: { refreshed: string; fx: string }) {
  const [pending, start] = useTransition();
  const { say, toast } = useToast();
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
      <div className="flex justify-between gap-2 text-xs text-muted">
        <span>Prices</span>
        <span className="text-right tabular-nums">{refreshed}</span>
      </div>
      <div className="flex justify-between text-[13px]">
        <span className="text-ink-2">USD/IDR</span>
        <span className="font-semibold tabular-nums">{fx}</span>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await refreshAction();
            say(res.ok ? res.message : res.error);
          })
        }
        className="min-h-11 rounded-[10px] bg-fill text-[13px] font-semibold text-ink hover:bg-fill-strong disabled:opacity-60 lg:min-h-[34px]"
      >
        {pending ? "Refreshing..." : "Refresh prices"}
      </button>
      {toast}
    </div>
  );
}
