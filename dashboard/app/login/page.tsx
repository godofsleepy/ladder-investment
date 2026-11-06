import { safeNext } from "@ladder/auth";
import { googleEnabled } from "@ladder/google";
import { canEmail } from "@ladder/mail";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";
import { currentUser, startPage } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in · Ladder" };

const ERRORS: Record<string, string> = { google: "Google sign-in didn't finish. Try again." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; error?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const user = await currentUser();
  if (user) redirect(next ?? startPage(user));

  return (
    <AuthLayout>
      {params.error && ERRORS[params.error] ? <p role="alert" className="m-0 rounded-[10px] bg-bad/10 px-3 py-2.5 text-[13px] font-semibold text-ink">{ERRORS[params.error]}</p> : null}
      <LoginForm
        next={next ?? ""}
        google={googleEnabled()}
        canEmail={canEmail()}
        notice={params.reset ? "Password changed. Sign in with the new one." : undefined}
      />
    </AuthLayout>
  );
}
