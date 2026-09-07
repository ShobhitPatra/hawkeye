"use client";

import { authClient } from "@/auth-client";

export function SignInButton({
  callbackURL = "/overview",
  variant,
}: {
  callbackURL?: string;
  variant?: "primary";
}) {
  return (
    <button
      type="button"
      className="hk-button"
      data-variant={variant}
      onClick={() => authClient.signIn.social({ provider: "github", callbackURL })}
    >
      Sign in with GitHub
    </button>
  );
}
