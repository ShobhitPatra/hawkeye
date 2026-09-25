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
  const [expected, setExpected] = useState<{ from: boolean; to: boolean } | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [settled, setSettled] = useState(false);
  const [pending, startTransition] = useTransition();
  if (expected !== undefined && reviewing !== expected.from) setExpected(undefined);
  const shown = expected?.to ?? reviewing;
  const words = reviewControlWords({ reviewing: shown, pending });
  const toggle = () => {
    if (pending) return;
    const next = !shown;
    setExpected({ from: reviewing, to: next });
    setFailed(undefined);
    startTransition(async () => {
      const form = new FormData();
      form.set("owner", reference.owner);
      form.set("repo", reference.repo);
      form.set("number", String(reference.number));
      form.set("installationId", installationId);
      try {
        await (next ? armAction : disarmAction)(form);
        setSettled(true);
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
        data-settled={settled ? "" : undefined}
        aria-pressed={shown}
        aria-disabled={pending}
        aria-label={`Reviews for ${reference.owner}/${reference.repo} #${reference.number}`}
        onClick={toggle}
        onPointerLeave={() => setSettled(false)}
      >
        <i />
        <span className="hk-review-word" aria-hidden="true">
          {pending ? "" : words.word}
        </span>
        <span className="hk-review-next" aria-hidden="true">
          {pending ? "" : words.next}
        </span>
        <span className="hk-status" data-state="running" aria-hidden="true">
          {pending ? words.word : ""}
        </span>
      </button>
      {failed && <span className="hk-metadata">{failed}</span>}
    </span>
  );
}
