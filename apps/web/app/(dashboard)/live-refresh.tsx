"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { REFRESH_INTERVAL_MS, shouldRefresh, updatedAgo } from "@/freshness";

export function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  inFlight.current = pending;
  const refresh = () => {
    if (
      !shouldRefresh({ visible: document.visibilityState === "visible", pending: inFlight.current })
    )
      return;
    startTransition(() => {
      router.refresh();
      setUpdatedAt(Date.now());
    });
  };
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const onTimer = () => latest.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = setInterval(onTimer, REFRESH_INTERVAL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onTimer);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onTimer);
    };
  }, []);
  return (
    <>
      <span className="hk-fresh">{updatedAgo(now - updatedAt)}</span>
      {pending && <div className="hk-progress" aria-hidden="true" />}
    </>
  );
}
