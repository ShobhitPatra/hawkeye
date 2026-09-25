"use client";

import { useEffect, useRef, useState } from "react";

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" />
      <path
        d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"
        stroke="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const settle = (next: "copied" | "refused") => {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };
  const label =
    state === "copied" ? "Copied" : state === "refused" ? "Press Ctrl+C to copy" : "Copy";
  return (
    <button
      type="button"
      className="hk-copy"
      data-state={state}
      aria-label={label}
      title={label}
      onClick={async (event) => {
        try {
          await navigator.clipboard.writeText(text);
          settle("copied");
        } catch {
          const code = event.currentTarget.previousElementSibling;
          if (code) window.getSelection()?.selectAllChildren(code);
          settle("refused");
        }
      }}
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      {state === "refused" && <span>Ctrl+C</span>}
      <span role="status" className="hk-visually-hidden">
        {state === "idle" ? "" : label}
      </span>
    </button>
  );
}
