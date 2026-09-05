"use client";

import { useActionState } from "react";
import { type ApproveRunnerLoginState, approveRunnerLoginAction } from "./actions";

export type LoginCodeState =
  | { state: "pending"; runnerName: string; requested: string }
  | { state: "approved"; runnerName: string }
  | { state: "expired" };

export function ApproveLoginForm({ code }: { code?: LoginCodeState }) {
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
      {code?.state === "pending" && (
        <p className="hk-compact hk-muted">
          Requested {code.requested} by a runner named{" "}
          <span className="hk-mono">{code.runnerName}</span>. Approve it only if that is your
          machine.
        </p>
      )}
      {code?.state === "approved" && (
        <p className="hk-compact hk-muted">
          This code was already approved for <span className="hk-mono">{code.runnerName}</span>.
        </p>
      )}
      {code?.state === "expired" && (
        <p className="hk-compact">
          This code is not pending. Codes last ten minutes; run the login command again for a new
          one.
        </p>
      )}
    </>
  );
}
