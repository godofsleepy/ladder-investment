"use client";
import { useActionState } from "react";
import { resetAction } from "@/app/login/actions";
import { PasswordField } from "./PasswordField";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAction, undefined);
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-[13px] font-semibold text-ink-2">New password</label>
        <PasswordField autoComplete="new-password" placeholder="Create a password" />
        <span className="text-xs text-muted">At least 8 characters.</span>
      </div>
      {state?.error ? <p role="alert" className="m-0 rounded-[10px] bg-bad/10 px-3 py-2.5 text-[13px] font-semibold text-ink">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="h-[46px] rounded-xl bg-brand text-[15px] font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60">
        {pending ? "One moment..." : "Set new password"}
      </button>
    </form>
  );
}
