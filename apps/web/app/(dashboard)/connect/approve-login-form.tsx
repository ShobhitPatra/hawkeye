"use client";

import { useActionState } from "react";
import { type ApproveRunnerLoginState, approveRunnerLoginAction } from "./actions";

export function ApproveLoginForm() {
  const [state, formAction, pending] = useActionState<ApproveRunnerLoginState, FormData>(
    approveRunnerLoginAction,
    {},
  );

  if (state.runnerName)
    return (
      <div className="hk-state">
        <p>
          Runner <span className="hk-mono">{state.runnerName}</span> connected.
        </p>
        <p>Go back to your terminal; it is already polling.</p>
      </div>
    );

  return (
    <>
      <form action={formAction} className="hk-form-row">
        <input
          className="hk-input hk-mono"
          name="code"
          placeholder="XXXX-XXXX"
          aria-label="Login code"
          autoComplete="off"
        />
        <button type="submit" className="hk-button" data-variant="primary" disabled={pending}>
          Approve
        </button>
      </form>
      {state.error && <p className="hk-compact">{state.error}</p>}
    </>
  );
}
