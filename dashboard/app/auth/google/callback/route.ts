import { googleUser, safeNext } from "@ladder/auth";
import { getPool } from "@ladder/db";
import { googleProfile } from "@ladder/google";
import { LadderError } from "@ladder/money";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { baseFrom } from "@/lib/cookies";
import { startPage, startSession } from "@/lib/session";

const COOKIE = "ladder_google";

export async function GET(req: NextRequest) {
  const base = baseFrom(req.headers);
  const failed = () => NextResponse.redirect(new URL("/login?error=google", base));
  const jar = await cookies();
  const saved = jar.get(COOKIE)?.value;
  jar.delete(COOKIE);
  const { state, next } = saved ? (JSON.parse(saved) as { state: string; next: string }) : { state: "", next: "" };
  const code = req.nextUrl.searchParams.get("code");
  if (!state || !code || req.nextUrl.searchParams.get("state") !== state) return failed();

  try {
    const profile = await googleProfile(code, `${base}/auth/google/callback`);
    const user = await googleUser(getPool(), profile);
    await startSession(user.id);
    return NextResponse.redirect(new URL(safeNext(next) ?? startPage(user), base));
  } catch (err) {
    if (err instanceof LadderError) return failed();
    throw err;
  }
}
