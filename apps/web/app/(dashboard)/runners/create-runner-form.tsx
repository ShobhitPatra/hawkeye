"use client";

import { useActionState } from "react";
import { type CreateRunnerState, createRunnerAction } from "./actions";

export function CreateRunnerForm() {
  const [state, formAction, pending] = useActionState<CreateRunnerState, FormData>(
    createRunnerAction,
    {},
  );

  return (
    <>
      <form action={formAction}>
        <input name="name" placeholder="laptop" aria-label="Runner name" />
        <button type="submit" disabled={pending}>
          Create runner
        </button>
      </form>
      {state.error && <p>{state.error}</p>}
      {state.token && (
        <p>
          Copy this token now, it is shown once: <code>{state.token}</code>
        </p>
      )}
    </>
  );
}
