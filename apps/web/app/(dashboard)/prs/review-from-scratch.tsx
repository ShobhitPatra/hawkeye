"use client";

import { useState, useTransition } from "react";
import type { PullRequestReference } from "@hawkeye/core";
import { reviewFromScratchAction } from "./actions";

export function ReviewFromScratch({
  reference,
  installationId,
}: {
  reference: PullRequestReference;
  installationId: string;
}) {
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const queue = () => {
    if (pending) return;
    setFailed(false);
    startTransition(async () => {
      const form = new FormData();
      form.set("owner", reference.owner);
      form.set("repo", reference.repo);
      form.set("number", String(reference.number));
      form.set("installationId", installationId);
      try {
        await reviewFromScratchAction(form);
      } catch {
        setFailed(true);
      }
    });
  };
  return (
    <span className="hk-review">
      <button type="button" className="hk-button" aria-disabled={pending} onClick={queue}>
        {pending ? (
          <span className="hk-status" data-state="running">
            Queuing
          </span>
        ) : (
          "Review from scratch"
        )}
      </button>
      {failed && <span className="hk-metadata">Could not queue. Try again.</span>}
    </span>
  );
}
