"use client";

import { authClient } from "@/auth-client";

export function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/prs" })}
    >
      Sign in with GitHub
    </button>
  );
}
