"use client";

import { useTransition } from "react";
import { authClient } from "@/auth-client";

export function SignInButton({
  callbackURL = "/overview",
  variant,
}: {
  callbackURL?: string;
  variant?: "primary";
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="hk-button"
      data-variant={variant}
      aria-disabled={pending}
      onClick={() => {
        if (pending) return;
        startTransition(async () => {
          await authClient.signIn.social({ provider: "github", callbackURL });
        });
      }}
    >
      {pending ? "Opening GitHub" : "Sign in with GitHub"}
    </button>
  );
}
