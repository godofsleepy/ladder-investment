import Link from "next/link";
import { CopyContext } from "@/components/CopyContext";
import { Badge, Empty, PageTitle, Tally } from "@/components/ui";
import { macroRef } from "@/lib/context";
import { fd, MACRO_BADGE, moneyOf, pc } from "@/lib/format";
import { macroViews, moneySetting } from "@/lib/ladder";

const SIGNAL_DOT = { for: "bg-good", against: "bg-bad", watch: "bg-faint" } as const;
const SIGNAL_WORD = { for: "For", against: "Against", watch: "Watching" } as const;

export default async function ThesesPage() {
  const [views, base] = await Promise.all([macroViews(), moneySetting()]);
  const { money } = moneyOf(base);
  const states = ["weak", "broken", "review", "holding"] as const;

  return (
    <>
      <PageTitle title="Theses" sub="How I read the macro picture, and which holdings ride on each view." />
      {views.length === 0 ? (
        <Empty title="No macro views yet">
          Tell your agent how you read the world and what rides on it, for example: "Macro view, weak rupiah: the rupiah keeps losing ground through 2027. BTC and gold ride on it. Wrong if USD/IDR falls below 15,500 for a quarter."
        </Empty>
      ) : (
        <>
          <Tally items={states.map((s) => ({ label: MACRO_BADGE[s].label, dot: MACRO_BADGE[s].dot, n: views.filter((v) => v.state === s).length })).filter((s) => s.n > 0)} />
          <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
            {views.map((v) => {
              const badge = MACRO_BADGE[v.state];
              return (
                <article key={v.id} className="card flex flex-col gap-3.5 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold tracking-[.06em] text-muted uppercase">{v.area} · {v.conviction} conviction</span>
                      <CopyContext id={v.id} label={`macro view #${v.id}`} text={macroRef(v.id, v.short_name)} />
                    </span>
                    <Badge className={badge.className}>{badge.label}</Badge>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <h2 className="m-0 text-[18px] leading-[1.3] font-bold text-pretty">{v.view}</h2>
                    {v.why ? <p className="m-0 text-sm leading-normal text-pretty text-ink-2">{v.why}</p> : null}
                  </div>
                  {v.signals.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-muted">Signals I watch</span>
                      {v.signals.map((s, i) => (
                        <div key={i} className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
                          <span title={SIGNAL_WORD[s.kind]} className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${SIGNAL_DOT[s.kind]}`}>
                            <span className="sr-only">{SIGNAL_WORD[s.kind]}: </span>
                          </span>
                          <span>{s.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <span className="flex justify-between gap-3 text-xs font-semibold text-muted">
                      <span>Holdings riding on it</span>
                      <span className="tabular-nums">{money(v.exposure_idr)} · {pc(v.exposure_pct)} of portfolio</span>
                    </span>
                    {v.symbols.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {v.symbols.map((symbol) => (
                          <Link key={symbol} href={`/assets/${symbol}?from=theses`} className="flex h-7 items-center rounded-lg bg-brand-soft px-2.5 text-xs font-bold">{symbol}</Link>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[13px] text-muted">None held right now.</span>
                    )}
                  </div>
                  <div className="mt-auto flex flex-col gap-1 border-t border-line-soft pt-3 text-[13px] leading-[1.45]">
                    <span><b className="font-semibold">Wrong if:</b> <span className="text-ink-2">{v.wrong_if}</span></span>
                    <span className="text-xs text-muted">{v.overdue ? `Review was due ${fd(v.next_review)}` : `Next review ${fd(v.next_review)}`}</span>
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}
