import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { fetchTechnicianJobs } from "@/lib/pockit";
import { LoginClient } from "./LoginClient";

export default async function LoginPage() {
  const me = await currentUser();
  if (me) {
    // Only bounce to /orders when the Pockit token is still LIVE. A stale signed
    // cookie (token evicted after signing in elsewhere) must fall through to the
    // login form instead of trapping the user in a redirect to a dead session.
    const jobs = await fetchTechnicianJobs(me.pockitToken ?? "", me.user.id);
    if (jobs !== null) redirect("/orders");
  }
  return <LoginClient />;
}
