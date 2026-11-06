import { getPool } from "@ladder/db";
import { OAuthError, validateAuthorize, type AuthorizeRequest } from "@ladder/oauth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { currentUser } from "@/lib/session";
import { decide } from "./actions";

export const metadata: Metadata = { title: "Connect an assistant · Ladder" };

type Params = Record<string, string | undefined>;

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) {
    const path = `/oauth/authorize?${new URLSearchParams(params as Record<string, string>)}`;
    redirect(`/login?${new URLSearchParams({ next: path })}`);
  }

  let request: AuthorizeRequest;
  try {
    request = await validateAuthorize(getPool(), params);
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    return (
      <AuthLayout>
        <div role="alert" className="flex flex-col gap-1.5">
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.5px]">This connection can't continue</h2>
          <p className="m-0 text-[15px] text-ink-2">{err.message}. Start again from your assistant.</p>
        </div>
      </AuthLayout>
    );
  }

  const write = user.mcp_access === "rw";
  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[28px] font-bold tracking-[-0.5px] [overflow-wrap:anywhere]">Connect {request.client.client_name}?</h2>
        <p className="m-0 text-[15px] text-ink-2">Signed in as {user.email}.</p>
      </div>
      <div className="card flex flex-col gap-2 p-5 text-[15px]">
        <p className="m-0 font-semibold">It will be able to:</p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-ink-2">
          <li>See your portfolio, watchlist, theses and notes</li>
          {write ? <li>Log trades and edit your watchlist, theses and notes</li> : <li>Change nothing, because your assistants are set to read only</li>}
        </ul>
        <p className="m-0 mt-1 text-[13px] text-muted">
          It returns to <span className="[overflow-wrap:anywhere]">{new URL(request.redirectUri).host}</span>. Disconnect it at any time on your Account page.
        </p>
      </div>
      <form action={decide} className="flex gap-2">
        <input type="hidden" name="client_id" value={request.client.client_id} />
        <input type="hidden" name="redirect_uri" value={request.redirectUri} />
        <input type="hidden" name="code_challenge" value={request.codeChallenge} />
        <input type="hidden" name="state" value={request.state ?? ""} />
        <button type="submit" name="decision" value="deny" className="btn-soft h-[46px] flex-1">Cancel</button>
        <button type="submit" name="decision" value="allow" className="h-[46px] flex-1 rounded-xl bg-brand text-[15px] font-bold text-on-brand hover:bg-brand-dark">Connect</button>
      </form>
    </AuthLayout>
  );
}
