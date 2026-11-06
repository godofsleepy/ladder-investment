import { canEmail } from "@ladder/mail";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Assistants, type Assistant } from "@/components/account/Assistants";
import { DataSection } from "@/components/account/DataSection";
import { Preferences } from "@/components/account/Preferences";
import { baseFrom } from "@/lib/cookies";
import { fd } from "@/lib/format";
import { connections } from "@/lib/ladder";
import { requireUser } from "@/lib/session";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Account · Ladder" };

function describe(c: Awaited<ReturnType<typeof connections>>[number]): Assistant {
  const used = c.last_used_at ? `last used ${fd(c.last_used_at)}` : "never used";
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    meta: c.kind === "oauth" ? `Connected ${fd(c.created_at)} · ${used}` : `Token ••••${c.suffix} · ${used}`,
  };
}

function isPrivateAddress(base: string): boolean {
  const host = new URL(base).hostname;
  return host.endsWith(".ts.net") || host === "localhost" || host === "127.0.0.1" || /^100\./.test(host);
}

export default async function AccountPage() {
  const user = await requireUser();
  const base = baseFrom(await headers());
  const assistants = (await connections()).map(describe);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[32px] font-bold tracking-[-0.6px]">Account</h1>
          <p className="m-0 text-[15px] text-ink-2">
            Signed in as {user.email}. Only you can see your portfolio.
          </p>
        </div>
        <form action={signOut}>
          <button type="submit" className="btn-soft">Sign out</button>
        </form>
      </header>

      <Preferences
        baseCurrency={user.base_currency}
        startPage={user.start_page}
        notify={{ zone: user.notify_zone, review: user.notify_review, weekly: user.notify_weekly }}
        canEmail={canEmail()}
      />
      <Assistants url={`${base}/mcp`} isPrivate={isPrivateAddress(base)} access={user.mcp_access} assistants={assistants} />
      <DataSection />
    </div>
  );
}
