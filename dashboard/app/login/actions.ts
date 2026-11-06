"use server";
import {
  createPasswordReset,
  createUser,
  loginLockedFor,
  recordLoginFailure,
  resetLoginFailures,
  resetPassword,
  safeNext,
  signIn,
  validEmail,
} from "@ladder/auth";
import { getPool } from "@ladder/db";
import { canEmail, sendMail } from "@ladder/mail";
import { LadderError } from "@ladder/money";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { baseFrom } from "@/lib/cookies";
import { startPage, startSession } from "@/lib/session";

export type AuthState = { error?: string; ok?: string } | undefined;

const MISS_DELAY_MS = 400;

function waitText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

async function forgot(email: string): Promise<AuthState> {
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  if (canEmail()) {
    const reset = await createPasswordReset(getPool(), email);
    if (reset) {
      const link = `${baseFrom(await headers())}/reset?token=${reset.token}`;
      await sendMail({
        to: reset.email,
        subject: "Reset your Ladder password",
        text: `Open this link within an hour to set a new password:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
      });
    }
  }
  // The same answer either way, so this form can't be used to find out who has an account.
  return { ok: `If ${email} has an account, a reset link is on its way.` };
}

export async function authAction(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const mode = String(fd.get("mode") ?? "in");
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const next = safeNext(String(fd.get("next") ?? ""));

  if (mode === "forgot") return forgot(email);

  if (mode === "up") {
    let userId: number;
    let target: string;
    try {
      const user = await createUser(getPool(), { email, name: String(fd.get("name") ?? ""), password });
      userId = user.id;
      target = next ?? startPage(user);
    } catch (err) {
      if (err instanceof LadderError) return { error: err.message };
      throw err;
    }
    await startSession(userId);
    redirect(target);
  }

  if (!validEmail(email)) return { error: "Enter a valid email address." };
  if (!password) return { error: "Enter your password." };
  const locked = loginLockedFor();
  if (locked) return { error: `Too many wrong tries. Try again in ${waitText(locked)}.` };

  const user = await signIn(getPool(), email, password);
  if (!user) {
    recordLoginFailure();
    await new Promise((resolve) => setTimeout(resolve, MISS_DELAY_MS));
    return { error: "That email or password isn't right." };
  }
  resetLoginFailures();
  await startSession(user.id);
  redirect(next ?? startPage(user));
}

export async function resetAction(_prev: AuthState, fd: FormData): Promise<AuthState> {
  try {
    await resetPassword(getPool(), String(fd.get("token") ?? ""), String(fd.get("password") ?? ""));
  } catch (err) {
    if (err instanceof LadderError) return { error: err.message };
    throw err;
  }
  redirect("/login?reset=1");
}
