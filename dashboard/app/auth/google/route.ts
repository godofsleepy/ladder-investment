import { newSecret, safeNext } from "@ladder/auth";
import { googleAuthUrl, googleEnabled } from "@ladder/google";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { baseFrom } from "@/lib/cookies";

const GOOGLE_COOKIE = "ladder_google";

export async function GET(req: NextRequest) {
  const base = baseFrom(req.headers);
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login", base));
  const state = newSecret(16);
  const next = safeNext(req.nextUrl.searchParams.get("next")) ?? "";
  (await cookies()).set(GOOGLE_COOKIE, JSON.stringify({ state, next }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/auth/google",
    secure: base.startsWith("https:"),
    maxAge: 600,
  });
  return NextResponse.redirect(googleAuthUrl(`${base}/auth/google/callback`, state));
}
