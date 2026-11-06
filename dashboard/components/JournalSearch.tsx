"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function JournalSearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => router.replace(q.trim() ? `/journal?q=${encodeURIComponent(q.trim())}` : "/journal"), 250);
    return () => clearTimeout(timer);
  }, [q, router]);

  return (
    <label className="w-full max-w-[420px]">
      <span className="sr-only">Search notes or tickers</span>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search notes or tickers"
        className="box-border h-[42px] w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink"
      />
    </label>
  );
}
