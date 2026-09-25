"use client";

import type { useFormAction } from "../use-form-action";
import type { SaveState } from "./actions";

export function SaveRow({
  form,
  saved,
}: {
  form: ReturnType<typeof useFormAction<SaveState>>;
  saved: string;
}) {
  const sentence = form.pending
    ? "Saving"
    : form.dirty
      ? ""
      : (form.state.error ?? (form.state.saved ? saved : ""));
  return (
    <div className="hk-action-row">
      <button type="submit" className="hk-button" data-variant="primary" disabled={form.pending}>
        Save
      </button>
      <span role="status">
        {sentence && (
          <span
            key={sentence}
            className={form.state.error && !form.dirty ? "hk-refusal hk-arrive" : "hk-arrive"}
          >
            {sentence}
          </span>
        )}
      </span>
    </div>
  );
}
