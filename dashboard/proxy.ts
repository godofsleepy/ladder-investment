import { NextResponse, type NextRequest } from "next/server";
import { baseFrom, SESSION_COOKIE, sessionCookie } from "./lib/cookies";

/**
 * A quick gate so signed-out visitors land on /login. It only checks that a cookie exists:
 * the real check is requireUser(), which every page's data goes through.
 */
export function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const base = baseFrom(req.headers);

  if (token) {
    const res = NextResponse.next();
    res.cookies.set(SESSION_COOKIE, token, sessionCookie(base.startsWith("https:")));
    return res;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return new NextResponse("Sign in first", { status: 401 });

  const { pathname, search } = req.nextUrl;
  const path = pathname === "/" ? "/login" : `/login?${new URLSearchParams({ next: pathname + search })}`;
  return NextResponse.redirect(new URL(path, base));
}

export const config = {
  matcher: ["/((?!login|reset|auth/|mcp|oauth/token|oauth/register|\\.well-known|_next/|favicon.ico).*)"],
};
