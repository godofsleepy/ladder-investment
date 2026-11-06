"use client";
import { useActionState, useState } from "react";
import { authAction } from "@/app/login/actions";
import { PasswordField } from "./PasswordField";

type Mode = "in" | "up" | "forgot";

const TEXT: Record<Mode, { title: string; sub: string; cta: string }> = {
  in: { title: "Welcome back", sub: "Sign in to see your portfolio.", cta: "Sign in" },
  up: { title: "Create your Ladder", sub: "One account per person. Your portfolio stays private to you.", cta: "Create account" },
  forgot: { title: "Reset your password", sub: "We will email you a link to set a new password.", cta: "Send reset link" },
};

export function LoginForm({
  next,
  google,
  canEmail,
  notice,
}: {
  next: string;
  google: boolean;
  canEmail: boolean;
  notice?: string;
}) {
  const [state, action, pending] = useActionState(authAction, undefined);
  const [mode, setMode] = useState<Mode>("in");
  // Controlled, because React clears a form's uncontrolled fields after every submit, errors included.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const isUp = mode === "up";
  const text = TEXT[mode];
  const error = pending ? undefined : state?.error;
  const ok = pending ? undefined : (state?.ok ?? notice);
  const tab = (on: boolean) =>
    `h-9 flex-1 rounded-[9px] text-sm font-semibold text-ink ${on ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)]" : ""}`;
  const labelClass = "flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2";

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[28px] font-bold tracking-[-0.5px]">{text.title}</h2>
        <p className="m-0 text-[15px] text-ink-2">{mode === "forgot" && !canEmail ? "Email isn't set up on this Ladder yet." : text.sub}</p>
      </div>

      <div role="tablist" aria-label="Account" className="flex gap-1 rounded-xl bg-fill p-1">
        <button type="button" role="tab" aria-selected={!isUp} onClick={() => setMode("in")} className={tab(!isUp)}>Sign in</button>
        <button type="button" role="tab" aria-selected={isUp} onClick={() => setMode("up")} className={tab(isUp)}>Create account</button>
      </div>

      {mode === "forgot" && !canEmail ? (
        <div className="flex flex-col gap-3 text-[15px] text-ink-2">
          <p className="m-0">On the computer running Ladder, run this in the ladder folder, then open the link it prints:</p>
          <code className="rounded-xl bg-fill px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere] text-ink">npm run reset-password you@example.com</code>
          <button type="button" onClick={() => setMode("in")} className="self-start text-[13px] font-semibold text-brand">Back to sign in</button>
        </div>
      ) : (
        <form action={action} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="next" value={next} />
          {isUp ? (
            <label className={labelClass}>
              Name
              <input name="name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" className="input text-[15px] font-normal" />
            </label>
          ) : null}
          <label className={labelClass}>
            Email
            <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className="input text-[15px] font-normal" />
          </label>
          {mode !== "forgot" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="text-[13px] font-semibold text-ink-2">Password</label>
                {mode === "in" ? <button type="button" onClick={() => setMode("forgot")} className="text-[13px] font-semibold text-brand">Forgot password?</button> : null}
              </div>
              <PasswordField autoComplete={isUp ? "new-password" : "current-password"} placeholder={isUp ? "Create a password" : "Your password"} />
              {isUp ? <span className="text-xs text-muted">At least 8 characters.</span> : null}
            </div>
          ) : (
            <button type="button" onClick={() => setMode("in")} className="self-start text-[13px] font-semibold text-brand">Back to sign in</button>
          )}
          {error ? <p role="alert" className="m-0 rounded-[10px] bg-bad/10 px-3 py-2.5 text-[13px] font-semibold text-ink">{error}</p> : null}
          {ok ? <p role="status" className="m-0 rounded-[10px] bg-good/12 px-3 py-2.5 text-[13px] font-semibold text-ink">{ok}</p> : null}
          <button type="submit" disabled={pending} className="h-[46px] rounded-xl bg-brand text-[15px] font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60">
            {pending ? "One moment..." : text.cta}
          </button>
        </form>
      )}

      {google ? (
        <>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex-1 border-t border-line" />or<span className="flex-1 border-t border-line" />
          </div>
          <a href={`/auth/google?next=${encodeURIComponent(next)}`} className="flex h-[46px] items-center justify-center gap-2.5 rounded-xl border border-line bg-surface text-[15px] font-semibold text-ink hover:bg-hover hover:text-ink">
            <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="9" cy="9" r="7" /><path d="M9 8h6" /></svg>
            Continue with Google
          </a>
        </>
      ) : null}

      <p className="m-0 text-center text-xs leading-normal text-muted">Ladder never asks for your broker password.</p>
    </>
  );
}
