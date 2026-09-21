import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { StartForm } from "@/components/StartForm";
import { CATEGORIES } from "@/lib/categories";

export default async function SelfCheck() {
  const me = await currentUser();
  if (!me) redirect("/login");
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-12 sm:py-20">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-brand px-2 py-1 font-display text-sm font-bold text-white">
              id chip.ai
            </span>
            <span className="text-sm text-muted">System Health Check</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-muted hover:text-foreground">
              Technician sign-in
            </Link>
            <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">
              Dashboard →
            </Link>
          </div>
        </div>

        <h1 className="mt-6 font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
          Check your system&rsquo;s{" "}
          <span className="text-brand">health</span> in one click.
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
          A web-based diagnostic that inspects performance, storage, battery,
          drivers, network and core components — then gives you a clear,
          confidence-scored health report.
        </p>

        <div className="mt-8 rounded-3xl border border-border bg-surface-2 p-6 shadow-sm">
          <StartForm />
        </div>

        <div className="mt-10">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            What gets checked
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <span
                key={cat.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
              >
                <span aria-hidden>{cat.icon}</span>
                {cat.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
