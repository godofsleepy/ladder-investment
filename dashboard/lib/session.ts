import { createSession, sessionUser, type User } from "@ladder/auth";
import { getPool } from "@ladder/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { baseFrom, SESSION_COOKIE, sessionCookie } from "./cookies";

/** The signed-in account for this request. Every page's data goes through this, so none can skip it. */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionUser(getPool(), token);
});

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function startSession(userId: number): Promise<void> {
  const { token } = await createSession(getPool(), userId);
  const secure = baseFrom(await headers()).startsWith("https:");
  (await cookies()).set(SESSION_COOKIE, token, sessionCookie(secure));
}

export const startPage = (user: User) => (user.start_page === "watchlist" ? "/watchlist" : "/");
