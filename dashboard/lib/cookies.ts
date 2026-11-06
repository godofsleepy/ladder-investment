export const SESSION_COOKIE = "ladder_session";
export const SESSION_SECONDS = 30 * 86_400;

/** Cookies over plain http (localhost) can't be Secure, or the browser drops them. */
export const sessionCookie = (secure: boolean) =>
  ({ httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: SESSION_SECONDS }) as const;

/** The address people reached this server on. LADDER_PUBLIC_URL wins, for servers behind a proxy that hides it. */
export function baseFrom(h: Headers): string {
  const configured = process.env.LADDER_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "127.0.0.1:3100";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}
