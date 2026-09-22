"use client";

import { useRouter } from "next/navigation";

/** End-of-visit sign-out — clears the short-lived session (feature: security). */
export function SignOutButton({ label = "Log out" }: { label?: string }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }
  return (
    <button
      onClick={signOut}
      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-bad hover:text-bad"
    >
      {label}
    </button>
  );
}
