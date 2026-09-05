"use client";

import { useActionState } from "react";
import { type CreateRunnerState, createRunnerAction } from "./actions";
import { TokenShown } from "./token-shown";

export function CreateRunnerForm({ controlPlaneUrl }: { controlPlaneUrl: string }) {
  const [state, formAction, pending] = useActionState<CreateRunnerState, FormData>(
    createRunnerAction,
    {},
  );

  if (state.token) return <TokenShown token={state.token} controlPlaneUrl={controlPlaneUrl} />;
  return (
    <div className="hk-section">
      <form action={formAction} className="hk-form-row">
        <input
          className="hk-input"
          name="name"
          placeholder="Runner name, for example vps-hetzner"
          aria-label="Runner name"
        />
        <button type="submit" className="hk-button" disabled={pending}>
          Create
        </button>
      </form>
      {state.error && <p className="hk-compact hk-muted">{state.error}</p>}
    </div>
  );
}
