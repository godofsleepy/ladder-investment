"use client";
import Link from "next/link";
import { useTransition } from "react";
import { ignoreAlertAction, restoreAlertAction, type Result } from "@/app/(app)/actions";
import { POSITION_BADGE, positionWhy } from "@/lib/format";
import type { Position } from "@/lib/ladder";
import { useToast } from "./Toast";
import { Badge } from "./ui";

const smallButton = "min-h-11 shrink-0 rounded-lg bg-fill px-2.5 text-xs font-semibold text-ink-2 hover:bg-fill-strong disabled:opacity-60 sm:min-h-8";

export function PositionAlerts({ alerts, ignored }: { alerts: Position[]; ignored: Position[] }) {
  const [pending, start] = useTransition();
  const { say, toast } = useToast();
  const run = (action: Promise<Result>) =>
    start(async () => {
      const res = await action;
      say(res.ok ? res.message : res.error);
    });

  return (
    <div className="card flex flex-col gap-2 px-2 pt-5 pb-3">
      <div className="flex items-baseline justify-between px-3">
        <h2 className="m-0 text-[17px] font-bold">Position alerts</h2>
        <span className="text-[13px] text-muted">{alerts.length} need attention</span>
      </div>
      {alerts.length === 0 ? (
        <p className="m-0 px-3 py-2.5 text-sm text-ink-2">{ignored.length > 0 ? "Nothing else needs attention." : "Every position is on track."}</p>
      ) : (
        <div className="flex flex-col">
          {alerts.map((p) => (
            <div key={p.symbol} className="flex items-center gap-2 rounded-xl pr-3 hover:bg-hover">
              <Link href={`/assets/${p.symbol}`} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 pl-3 text-ink hover:text-ink">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{p.symbol}</span>
                  <span className="text-[13px] text-pretty text-ink-2">{positionWhy(p)}</span>
                </span>
                <Badge className={POSITION_BADGE[p.state].className}>{POSITION_BADGE[p.state].label}</Badge>
              </Link>
              <button type="button" disabled={pending} aria-label={`Ignore ${p.symbol} alert`} onClick={() => run(ignoreAlertAction(p.symbol))} className={smallButton}>
                Ignore
              </button>
            </div>
          ))}
        </div>
      )}
      {ignored.length > 0 ? (
        <details className="px-3 pt-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-ink-2 sm:min-h-8">{ignored.length} ignored</summary>
          <div className="flex flex-col">
            {ignored.map((p) => (
              <div key={p.symbol} className="flex items-center justify-between gap-3 border-t border-line-soft py-2">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{p.symbol}</span>
                  <span className="text-[13px] text-pretty text-muted">{positionWhy(p)}</span>
                </span>
                <button type="button" disabled={pending} aria-label={`Restore ${p.symbol} alert`} onClick={() => run(restoreAlertAction(p.symbol))} className={smallButton}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {toast}
    </div>
  );
}
