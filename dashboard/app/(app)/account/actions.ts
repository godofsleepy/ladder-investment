"use server";
import { createApiToken, deleteUser, endSession, revokeConnection, updatePreferences, type User } from "@ladder/auth";
import { getPool } from "@ladder/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/cookies";
import { requireUser } from "@/lib/session";

export type Preference = Partial<Pick<User, "base_currency" | "start_page" | "notify_zone" | "notify_review" | "notify_weekly" | "mcp_access">>;

/** Server actions can be called directly, so values are checked here rather than trusted from the form. */
function clean(change: Preference): Preference {
  const out: Preference = {};
  if (change.base_currency === "IDR" || change.base_currency === "USD") out.base_currency = change.base_currency;
  if (change.start_page === "portfolio" || change.start_page === "watchlist") out.start_page = change.start_page;
  if (change.mcp_access === "ro" || change.mcp_access === "rw") out.mcp_access = change.mcp_access;
  for (const key of ["notify_zone", "notify_review", "notify_weekly"] as const) {
    if (typeof change[key] === "boolean") out[key] = change[key];
  }
  return out;
}

export async function savePreference(change: Preference): Promise<void> {
  const user = await requireUser();
  await updatePreferences(getPool(), user.id, clean(change));
  revalidatePath("/", "layout");
}

export async function newToken(): Promise<string> {
  const user = await requireUser();
  const { token } = await createApiToken(getPool(), user.id);
  revalidatePath("/", "layout");
  return token;
}

export async function revokeAssistant(id: number): Promise<void> {
  const user = await requireUser();
  await revokeConnection(getPool(), user.id, Number(id));
  revalidatePath("/", "layout");
}

async function clearSession(): Promise<string | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  return token;
}

export async function signOut(): Promise<void> {
  await endSession(getPool(), await clearSession());
  redirect("/login");
}

export async function deleteAccount(confirmation: string): Promise<void> {
  const user = await requireUser();
  if (confirmation.trim() !== "DELETE") return;
  await deleteUser(getPool(), user.id);
  await clearSession();
  redirect("/login");
}
