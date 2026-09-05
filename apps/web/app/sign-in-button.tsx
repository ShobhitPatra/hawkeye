"use client";

import { authClient } from "@/auth-client";

export function SignInButton({ callbackURL = "/overview" }: { callbackURL?: string }) {
  return (
    <button
      type="button"
      onClick={() => authClient.signIn.social({ provider: "github", callbackURL })}
    >
      Sign in with GitHub
    </button>
  );
}
