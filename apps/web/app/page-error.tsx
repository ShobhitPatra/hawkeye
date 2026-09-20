"use client";

import type { ReactNode } from "react";

export type PageErrorProps = { error: Error & { digest?: string }; reset: () => void };

export function PageError({ reset, onward }: { reset: () => void; onward: ReactNode }) {
  return (
    <div className="hk-section">
      <div className="hk-state">
        <p>This page could not be shown.</p>
        <p>Something failed on our side while building it. Nothing of yours was lost.</p>
      </div>
      <div className="hk-actions">
        <button type="button" className="hk-button" onClick={reset}>
          Try again
        </button>
        {onward}
      </div>
    </div>
  );
}
