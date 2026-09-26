"use client";

import { useState, useTransition } from "react";
import type { PullRequestReference } from "@hawkeye/core";
import { armAction, disarmAction } from "./actions";

export function ReviewToggle({
  reference,
  installationId,
  reviewing,
}: {
  reference: PullRequestReference;
  installationId: string;
  reviewing: boolean;
}) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const toggle = () => {
    if (pending) return;
    setFailed(undefined);
    startTransition(async () => {
      const form = new FormData();
      form.set("owner", reference.owner);
      form.set("repo", reference.repo);
      form.set("number", String(reference.number));
      form.set("installationId", installationId);
      try {
        await (reviewing ? disarmAction : armAction)(form);
      } catch {
        setFailed(reviewing ? "Could not pause. Try again." : "Could not turn on. Try again.");
      }
    });
  };
  return (
    <span className="hk-review">
      <button type="button" className="hk-button" aria-disabled={pending} onClick={toggle}>
        {pending ? (
          <span className="hk-status" data-state="running">
            {reviewing ? "Pausing" : "Starting"}
          </span>
        ) : reviewing ? (
          "Pause reviews"
        ) : (
          "Turn reviews on"
        )}
      </button>
      {failed && <span className="hk-metadata">{failed}</span>}
    </span>
  );
}
