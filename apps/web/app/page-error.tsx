"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useTransition } from "react";

export type PageErrorProps = { error: Error & { digest?: string }; reset: () => void };

export function PageError({ reset, onward }: { reset: () => void; onward: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tryAgain = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <div className="hk-section">
      <div className="hk-state">
        <p>This page could not be shown.</p>
        <p>Something failed on our side while building it. Nothing of yours was lost.</p>
      </div>
      <div className="hk-actions">
        <button type="button" className="hk-button" onClick={tryAgain} disabled={pending}>
          {pending ? "Trying again" : "Try again"}
        </button>
        {onward}
      </div>
    </div>
  );
}
