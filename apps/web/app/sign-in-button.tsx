"use client";

import { useState, useTransition } from "react";
import { authClient } from "@/auth-client";

export function SignInButton({
  callbackURL = "/overview",
  variant,
}: {
  callbackURL?: string;
  variant?: "primary";
}) {
  const [transitioning, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const pending = transitioning || leaving;
  return (
    <button
      type="button"
      className="hk-button"
      data-variant={variant}
      aria-disabled={pending}
      onClick={() => {
        if (pending) return;
        startTransition(async () => {
          const result = await authClient.signIn.social({ provider: "github", callbackURL });
          if (!result.error) setLeaving(true);
        });
      }}
    >
      {pending ? "Opening GitHub" : "Sign in with GitHub"}
    </button>
  );
}
