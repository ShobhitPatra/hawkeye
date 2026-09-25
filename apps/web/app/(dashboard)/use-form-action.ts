"use client";

import { type FormEvent, useActionState, useState, useTransition } from "react";

export function useFormAction<State>(
  action: (previous: Awaited<State>, formData: FormData) => State | Promise<State>,
  initial: Awaited<State>,
) {
  const [state, formAction, acting] = useActionState(action, initial);
  const [transitioning, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setDirty(false);
    startTransition(() => formAction(formData));
  };
  return {
    state,
    pending: acting || transitioning,
    dirty,
    onInput: () => setDirty(true),
    onSubmit,
  };
}
