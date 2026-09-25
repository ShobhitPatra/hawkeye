"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-disabled={pending}
      onClick={() => {
        if (pending) return;
        startTransition(async () => {
          await authClient.signOut();
          router.push("/");
          router.refresh();
        });
      }}
    >
      {pending ? "Signing out" : "Sign out"}
    </button>
  );
}
