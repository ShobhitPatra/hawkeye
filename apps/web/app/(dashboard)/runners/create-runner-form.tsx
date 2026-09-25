"use client";

import { useFormAction } from "../use-form-action";
import { createRunnerAction } from "./actions";
import { TokenShown } from "./token-shown";

export function CreateRunnerForm({ controlPlaneUrl }: { controlPlaneUrl: string }) {
  const { state, pending, onSubmit } = useFormAction(createRunnerAction, {});

  if (state.token) return <TokenShown token={state.token} controlPlaneUrl={controlPlaneUrl} />;
  return (
    <div className="hk-section">
      <form onSubmit={onSubmit} className="hk-form-row">
        <input
          className="hk-input"
          name="name"
          placeholder="Runner name, for example vps-hetzner"
          aria-label="Runner name"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        <button type="submit" className="hk-button" disabled={pending}>
          Create
        </button>
      </form>
      {state.error && <p className="hk-compact hk-muted">{state.error}</p>}
    </div>
  );
}
