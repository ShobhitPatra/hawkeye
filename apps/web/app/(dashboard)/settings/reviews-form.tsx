"use client";

import { MAX_QUIET_WINDOW_SECONDS, type ReviewSettings } from "@/review-settings";
import type { SettingsField } from "@/user-settings";
import { useFormAction } from "../use-form-action";
import { saveReviewSettingsAction } from "./actions";
import { FieldRefusal } from "./field-refusal";
import { SaveRow } from "./save-row";

export function ReviewsForm({ settings }: { settings: ReviewSettings }) {
  const form = useFormAction(saveReviewSettingsAction, {});
  const refused = (field: SettingsField) =>
    form.state.field === field && !form.dirty ? form.state.error : undefined;
  return (
    <form onSubmit={form.onSubmit} onInput={form.onInput} className="hk-section" noValidate>
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
            required
            min={0}
            max={MAX_QUIET_WINDOW_SECONDS}
            step={1}
            defaultValue={settings.quietWindowSeconds}
            aria-invalid={refused("quietWindowSeconds") !== undefined}
            aria-describedby={refused("quietWindowSeconds") && "quiet-window-refusal"}
          />
          <span className="hk-compact hk-muted">seconds</span>
        </div>
        <FieldRefusal id="quiet-window-refusal" message={refused("quietWindowSeconds")} />
        <p className="hk-help">
          0 reviews each push at once. A wait lets a burst of pushes become one review.
        </p>
      </div>
      <SaveRow form={form} saved="Saved. Applies from the next pull request event." />
    </form>
  );
}
