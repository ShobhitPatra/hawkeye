"use client";

import { useActionState } from "react";
import { MAX_QUIET_WINDOW_SECONDS, type ReviewSettings } from "@/user-settings";
import { type SaveState, saveReviewSettingsAction } from "./actions";

export function ReviewsForm({ settings }: { settings: ReviewSettings }) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveReviewSettingsAction,
    {},
  );
  return (
    <form action={formAction} className="hk-section">
      <div className="hk-choice" data-stack>
        <label>
          <input type="checkbox" name="autoReview" defaultChecked={settings.autoReview} />
          Review my pull requests automatically
        </label>
        <label>
          <input type="checkbox" name="reviewDrafts" defaultChecked={settings.reviewDrafts} />
          Review drafts too
        </label>
      </div>
      <div className="hk-field">
        <label htmlFor="quiet-window">Wait after a push</label>
        <div className="hk-form-row">
          <input
            className="hk-input"
            id="quiet-window"
            name="quietWindowSeconds"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_QUIET_WINDOW_SECONDS}
            step={1}
            defaultValue={settings.quietWindowSeconds}
          />
          <span className="hk-compact hk-muted">seconds</span>
        </div>
        <p className="hk-help">
          0 reviews each push at once. A wait lets a burst of pushes become one review; a pull
          request can carry its own wait, which wins.
        </p>
      </div>
      <div className="hk-action-row">
        <button type="submit" className="hk-button" data-variant="primary" disabled={pending}>
          Save
        </button>
        <span>
          {state.error ??
            (state.saved ? "Saved. Applies from the next pull request event." : undefined)}
        </span>
      </div>
    </form>
  );
}
