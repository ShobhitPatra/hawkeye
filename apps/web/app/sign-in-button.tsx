"use client";

import { useEffect, useState, useTransition } from "react";
import { authClient } from "@/auth-client";

export function SignInButton({
  callbackURL = "/overview",
  variant,
  size,
}: {
  callbackURL?: string;
  variant?: "primary";
  size?: "large";
}) {
  const [transitioning, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const pending = transitioning || leaving;
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  return (
    <button
      type="button"
      className="hk-button"
      data-variant={variant}
      data-size={size}
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
