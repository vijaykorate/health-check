"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function StartHealthCheck({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/start`, { method: "POST" });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            d.error === "not_found"
              ? "This health-check order isn't assigned to you (or is no longer open)."
              : "Couldn't start the health check. Please try again.",
          );
        }
        const d = (await res.json()) as { url: string };
        if (active) router.replace(d.url);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [orderId, router]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      {error ? (
        <div className="rounded-2xl border border-bad/40 bg-bad-bg p-6 text-bad">
          <div className="font-display font-semibold">Couldn&rsquo;t open the health check</div>
          <p className="mt-1 text-sm">{error}</p>
          <Link
            href="/orders"
            className="mt-4 inline-block rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Back to orders
          </Link>
        </div>
      ) : (
        <>
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
          <p className="mt-4 text-sm text-muted">Starting the health check…</p>
        </>
      )}
    </main>
  );
}
