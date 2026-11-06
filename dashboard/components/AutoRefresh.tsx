"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const FOCUS_REFRESH_GAP_MS = 5000;

/** Data changes over MCP while this page sits open, so re-read it when the window regains focus. */
export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef(pathname);

  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    router.refresh();
  }, [pathname, router]);

  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < FOCUS_REFRESH_GAP_MS) return;
      last = Date.now();
      router.refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  return null;
}
