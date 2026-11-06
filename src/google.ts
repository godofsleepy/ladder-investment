import { LadderError } from "./money.js";

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function googleAuthUrl(redirectUri: string, state: string): string {
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

/** The ID token comes straight from Google over TLS in this call, so its contents can be read without re-checking the signature. */
export async function googleProfile(code: string, redirectUri: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { id_token?: string };
  const payload = body.id_token?.split(".")[1];
  if (!res.ok || !payload) throw new LadderError("Google sign-in didn't finish. Try again.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  if (!claims.sub || !claims.email) throw new LadderError("Google didn't share an email address.");
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: claims.name ?? "",
  };
}
