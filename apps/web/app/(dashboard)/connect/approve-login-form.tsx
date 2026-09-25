"use client";

import { useFormAction } from "../use-form-action";
import { approveRunnerLoginAction } from "./actions";

export type LoginCodeState =
  | { state: "pending"; runnerName: string; requested: string }
  | { state: "approved"; runnerName: string }
  | { state: "expired" };

export function ApproveLoginForm({
  code,
  prefill = "",
}: {
  code?: LoginCodeState;
  prefill?: string;
}) {
  const { state, pending, onSubmit } = useFormAction(approveRunnerLoginAction, {});

  if (state.runnerName)
    return (
      <div className="hk-state hk-arrive">
        <p>
          Runner <span className="hk-mono">{state.runnerName}</span> connected.
        </p>
        <p>Go back to your terminal; it is already polling.</p>
      </div>
    );

  return (
    <>
      <form onSubmit={onSubmit} className="hk-form-row">
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
          defaultValue={prefill}
          autoFocus={prefill === ""}
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
