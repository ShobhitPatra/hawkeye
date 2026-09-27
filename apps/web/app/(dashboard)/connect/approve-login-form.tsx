"use client";

import { useFormAction } from "../use-form-action";
import { approveRunnerLoginAction } from "./actions";

export function ApproveLoginForm() {
  const { state, pending, onSubmit } = useFormAction(approveRunnerLoginAction, {});

  if (state.runnerName)
    return (
      <div className="hk-state hk-arrive">
        <p>
          Runner <span className="hk-mono">{state.runnerName}</span> connected.
        </p>
        <p>It is reviewing now; leave that terminal open.</p>
      </div>
    );

  return (
    <>
      <form onSubmit={onSubmit} className="hk-form-row">
        {/* The code is typed, never filled from the link, so a link someone else sends cannot approve their runner in one click. */}
        <input
          className="hk-input hk-mono"
          name="code"
          placeholder="XXXX-XXXX"
          aria-label="Login code"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          autoFocus
        />
        <button type="submit" className="hk-button" data-variant="primary" disabled={pending}>
          Approve
        </button>
      </form>
      {state.error && <p className="hk-compact">{state.error}</p>}
    </>
  );
}
