"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { formatUpdated } from "@/format-updated";
import { REFRESH_INTERVAL_MS, shouldRefresh } from "@/freshness";

export function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const lastStart = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const refresh = () => {
    const started = Date.now();
    const visible = document.visibilityState === "visible";
    if (!shouldRefresh({ visible, pending, sinceLastStartMs: started - lastStart.current })) return;
    lastStart.current = started;
    startTransition(() => router.refresh());
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => latest.current(), REFRESH_INTERVAL_MS);
  };
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!pending) setUpdatedAt(Date.now());
  }, [pending]);
  useEffect(() => {
    const onReturn = () => latest.current();
    timer.current = window.setInterval(onReturn, REFRESH_INTERVAL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      window.clearInterval(timer.current);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, []);
  return (
    <>
      <span className="hk-fresh">
        Updated {formatUpdated(new Date(updatedAt).toISOString(), now)}
      </span>
      {pending && <div className="hk-progress" aria-hidden="true" />}
    </>
  );
}
