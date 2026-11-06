import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ResetForm } from "@/components/auth/ResetForm";

export const metadata: Metadata = { title: "Reset password · Ladder" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[28px] font-bold tracking-[-0.5px]">Choose a new password</h2>
        <p className="m-0 text-[15px] text-ink-2">This signs you out on every device.</p>
      </div>
      {token ? <ResetForm token={token} /> : <p className="m-0 text-[15px] text-ink-2">This link is missing its code. <Link href="/login">Ask for a new one</Link>.</p>}
    </AuthLayout>
  );
}
