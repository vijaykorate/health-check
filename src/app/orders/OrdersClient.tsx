"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { scoreTone } from "@/lib/score";
import { toneClasses } from "@/lib/ui";
import { SignOutButton } from "@/components/SignOutButton";
import { BrandMark } from "@/components/Brand";

interface OrderRow {
  orderId: string;
  customerName: string;
  deviceType: string;
  manufacturer: string;
  model: string;
  serviceType: string;
  territory: string;
  state: "open" | "in_progress" | "completed" | "failed";
  sessionId: string | null;
  healthScore: number | null;
  started: boolean;
}

function OrderCard({ o }: { o: OrderRow }) {
  const href =
    o.state === "open"
      ? `/orders/${o.orderId}`
      : o.sessionId
        ? `/check/${o.sessionId}`
        : `/orders/${o.orderId}`;

  return (
    <Link
      href={href}
      className="rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-brand"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display font-semibold text-foreground">{o.orderId}</span>
        <div className="flex items-center gap-2">
          {o.state === "in_progress" ? (
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">
              scanning…
            </span>
          ) : null}
          {o.state === "completed" && o.healthScore !== null ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${toneClasses[scoreTone(o.healthScore)]}`}
            >
              {o.healthScore}
            </span>
          ) : null}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
            {o.territory}
          </span>
        </div>
      </div>
      <div className="mt-1 text-sm text-foreground">
        {o.customerName} · {o.manufacturer} {o.model} ({o.deviceType})
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{o.serviceType}</span>
        <span className="text-xs font-medium text-brand">
          {o.state === "open"
            ? o.started
              ? "Start →"
              : "Awaiting job start"
            : o.state === "in_progress"
              ? "Resume →"
              : "View report →"}
        </span>
      </div>
    </Link>
  );
}

export function OrdersClient({ technicianName }: { technicianName: string }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/orders", { cache: "no-store" });
        if (!active) return;
        if (r.status === 401) {
          // Pockit session no longer valid (e.g. signed in on the phone app).
          setExpired(true);
          return;
        }
        const d = await r.json();
        setOrders(d.orders ?? []);
      } catch {
        /* keep last state; next tick retries */
      }
    };
    load();
    // Poll infrequently (was every 3s — a request storm) and skip while the tab
    // is hidden. The orders list only needs to reflect in-progress/completed
    // occasionally, so 20s + visibility-pause is plenty and stops hammering the API.
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, 20000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  async function reLogin() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  const upcoming = orders?.filter((o) => o.state === "open" || o.state === "failed") ?? [];
  const ongoing = orders?.filter((o) => o.state === "in_progress") ?? [];
  const done = orders?.filter((o) => o.state === "completed") ?? [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-sm text-muted">Signed in — {technicianName}</span>
        </div>
        <SignOutButton />
      </div>

      <h1 className="mt-6 font-display text-2xl font-bold text-foreground">Your visits</h1>
      <p className="mt-2 text-sm text-muted">
        Pick the order you&rsquo;re on-site for. You&rsquo;ll confirm the customer&rsquo;s consent
        code before the scan starts.
      </p>

      {expired ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <p className="font-medium text-foreground">Your session has expired</p>
          <p className="mt-1 text-sm text-muted">
            You may have signed in to the Pockit app on another device. Sign in again to
            reload your assigned orders.
          </p>
          <button
            type="button"
            onClick={reLogin}
            className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Sign in again
          </button>
        </div>
      ) : orders === null ? (
        <div className="mt-10 text-center text-muted">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5 text-muted">
          No orders assigned to you.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Ongoing ({ongoing.length})
            </h2>
            {ongoing.length === 0 ? (
              <p className="text-sm text-muted">No health checks in progress.</p>
            ) : (
              ongoing.map((o) => <OrderCard key={o.orderId} o={o} />)
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Upcoming ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">No upcoming orders.</p>
            ) : (
              upcoming.map((o) => <OrderCard key={o.orderId} o={o} />)
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Completed ({done.length})
            </h2>
            {done.length === 0 ? (
              <p className="text-sm text-muted">No completed health checks yet.</p>
            ) : (
              done.map((o) => <OrderCard key={o.orderId} o={o} />)
            )}
          </section>
        </div>
      )}
    </main>
  );
}
