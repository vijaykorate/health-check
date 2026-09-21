"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { scoreTone } from "@/lib/score";
import { toneClasses } from "@/lib/ui";
import { SignOutButton } from "@/components/SignOutButton";

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
            ? "Start →"
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

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/orders", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => active && setOrders(d.orders ?? []))
        .catch(() => active && setOrders([]));
    load();
    const t = setInterval(load, 3000); // reflect in-progress/completed live
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const open = orders?.filter((o) => o.state === "open") ?? [];
  const active = orders?.filter((o) => o.state === "in_progress") ?? [];
  const done = orders?.filter((o) => o.state === "completed") ?? [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-brand px-2 py-1 font-display text-sm font-bold text-white">
            id chip.ai
          </span>
          <span className="text-sm text-muted">Signed in — {technicianName}</span>
        </div>
        <SignOutButton />
      </div>

      <h1 className="mt-6 font-display text-2xl font-bold text-foreground">Your visits</h1>
      <p className="mt-2 text-sm text-muted">
        Pick the order you&rsquo;re on-site for. You&rsquo;ll confirm the customer&rsquo;s consent
        code before the scan starts.
      </p>

      {orders === null ? (
        <div className="mt-10 text-center text-muted">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5 text-muted">
          No orders assigned to you.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {active.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                In progress
              </h2>
              {active.map((o) => (
                <OrderCard key={o.orderId} o={o} />
              ))}
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Open ({open.length})
            </h2>
            {open.length === 0 ? (
              <p className="text-sm text-muted">All caught up — no open orders.</p>
            ) : (
              open.map((o) => <OrderCard key={o.orderId} o={o} />)
            )}
          </section>

          {done.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Completed
              </h2>
              {done.map((o) => (
                <OrderCard key={o.orderId} o={o} />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
