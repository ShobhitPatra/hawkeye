"use client";

import { useActionState } from "react";
import { type ApproveRunnerLoginState, approveRunnerLoginAction } from "./actions";

export function ApproveLoginForm() {
  const [state, formAction, pending] = useActionState<ApproveRunnerLoginState, FormData>(
    approveRunnerLoginAction,
    {},
  );

  if (state.runnerName) {
    return (
      <p>
        Runner <strong>{state.runnerName}</strong> connected. Go back to your terminal.
      </p>
    );
  }

  return (
    <>
      <form action={formAction}>
        <input name="code" placeholder="XXXX-XXXX" aria-label="Login code" autoComplete="off" />
        <button type="submit" disabled={pending}>
          Approve
        </button>
      </form>
      {state.error && <p>{state.error}</p>}
    </>
  );
}
