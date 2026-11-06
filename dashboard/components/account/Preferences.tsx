"use client";
import { useEffect, useState, useTransition } from "react";
import { savePreference, type Preference } from "@/app/(app)/account/actions";
import { Segmented } from "./Segmented";
import { useToast } from "@/components/Toast";

interface Props {
  baseCurrency: "IDR" | "USD";
  startPage: "portfolio" | "watchlist";
  notify: { zone: boolean; review: boolean; weekly: boolean };
  canEmail: boolean;
}

const row = "flex flex-wrap items-center justify-between gap-4 border-t border-line-soft py-3.5";

function Row({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className={row}>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[13px] text-muted">{help}</span>
      </div>
      {children}
    </div>
  );
}

const NOTIFICATIONS = [
  { key: "zone", field: "notify_zone", label: "Buy-zone hits", help: "Email me when a watchlist idea enters its buy zone." },
  { key: "review", field: "notify_review", label: "Thesis reviews", help: "Remind me when a thesis is due for review." },
  { key: "weekly", field: "notify_weekly", label: "Weekly summary", help: "A short portfolio email every Monday morning." },
] as const;

export function Preferences({ baseCurrency, startPage, notify, canEmail }: Props) {
  const [base, setBase] = useState(baseCurrency);
  const [start, setStart] = useState(startPage);
  const [toggles, setToggles] = useState(notify);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [, startTransition] = useTransition();
  const { say, toast } = useToast();

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  const save = (change: Preference) =>
    startTransition(async () => {
      await savePreference(change);
      say("Saved");
    });

  function pickTheme(next: "light" | "dark") {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ladder-theme", next);
    } catch {
      // Private windows can block storage; the theme still applies until reload.
    }
  }

  return (
    <>
      <section aria-labelledby="preferences" className="card flex flex-col px-5 pt-1">
        <h2 id="preferences" className="mt-4 mb-2 text-[17px] font-bold">Preferences</h2>
        <Row label="Base currency" help="Totals and P&L are shown in this currency.">
          <Segmented
            label="Base currency"
            value={base}
            options={[{ value: "IDR", label: "IDR" }, { value: "USD", label: "USD" }]}
            onPick={(value) => {
              setBase(value);
              save({ base_currency: value });
            }}
          />
        </Row>
        <Row label="Start page" help="What opens after you sign in.">
          <Segmented
            label="Start page"
            value={start}
            options={[{ value: "portfolio", label: "Portfolio" }, { value: "watchlist", label: "Watchlist" }]}
            onPick={(value) => {
              setStart(value);
              save({ start_page: value });
            }}
          />
        </Row>
        <Row label="Theme" help="Saved on this device.">
          <Segmented label="Theme" value={theme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onPick={pickTheme} />
        </Row>
        <div className="h-1.5" />
      </section>

      <section aria-labelledby="notifications" className="card flex flex-col px-5 pt-1">
        <h2 id="notifications" className="mt-4 mb-2 text-[17px] font-bold">Notifications</h2>
        {!canEmail ? (
          <p className="m-0 mb-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">
            Email isn't set up on this Ladder, so nothing is sent yet. Your choices are saved for when it is.
          </p>
        ) : null}
        {NOTIFICATIONS.map((n) => {
          const on = toggles[n.key];
          return (
            <label key={n.key} className="flex cursor-pointer items-center justify-between gap-4 border-t border-line-soft py-3.5">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{n.label}</span>
                <span className="text-[13px] text-muted">{n.help}</span>
              </span>
              <span className="relative h-7 w-[46px] shrink-0">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    setToggles((t) => ({ ...t, [n.key]: !on }));
                    save({ [n.field]: !on });
                  }}
                  className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
                />
                <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ${on ? "bg-brand" : "bg-fill-strong"}`} />
                <span aria-hidden="true" className={`pointer-events-none absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] ${on ? "left-[21px]" : "left-[3px]"}`} />
              </span>
            </label>
          );
        })}
        <div className="h-1.5" />
      </section>
      {toast}
    </>
  );
}
