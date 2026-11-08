"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2200);
  }, []);
  const toast = message ? (
    <div role="status" className="fixed bottom-20 left-1/2 z-20 w-max max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-2xl bg-ink px-4 py-2.5 text-center text-sm font-semibold text-pretty text-page shadow-[0_6px_20px_rgba(0,0,0,.18)] lg:bottom-6">
      {message}
    </div>
  ) : null;
  return { say, toast };
}
