"use client";

import { useState, useTransition } from "react";
import type { PullRequestReference } from "@hawkeye/core";
import { reviewControlWords } from "@/review-control-words";
import { armAction, disarmAction } from "./actions";

export function ReviewControl({
  reference,
  installationId,
  reviewing,
}: {
  reference: PullRequestReference;
  installationId: string;
  reviewing: boolean;
}) {
  const [expected, setExpected] = useState<boolean | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  if (expected !== undefined && expected === reviewing) setExpected(undefined);
  const shown = expected ?? reviewing;
  const words = reviewControlWords({ reviewing: shown, pending });
  const toggle = () => {
    if (pending) return;
    const next = !shown;
    setExpected(next);
    setFailed(undefined);
    startTransition(async () => {
      const form = new FormData();
      form.set("owner", reference.owner);
      form.set("repo", reference.repo);
      form.set("number", String(reference.number));
      form.set("installationId", installationId);
      try {
        await (next ? armAction : disarmAction)(form);
      } catch {
        setFailed(next ? "Could not start. Try again." : "Could not pause. Try again.");
        setExpected(undefined);
      }
    });
  };
  return (
    <span className="hk-review">
      <button
        type="button"
        className="hk-review-control"
        data-on={shown ? "" : undefined}
        data-pending={pending ? "" : undefined}
        aria-pressed={shown}
        aria-disabled={pending}
        onClick={toggle}
      >
        <i />
        {words.pending ? (
          <span className="hk-status" data-state="running">
            {words.word}
          </span>
        ) : (
          <>
            <span className="hk-review-word">{words.word}</span>
            <span className="hk-review-next">{words.next}</span>
          </>
        )}
      </button>
      {failed && <span className="hk-metadata">{failed}</span>}
    </span>
  );
}
