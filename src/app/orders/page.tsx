import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { fetchTechnicianJobs } from "@/lib/pockit";
import { OrdersClient } from "./OrdersClient";

export default async function OrdersPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  // The signed cookie can outlive the Pockit token (it gets evicted when the
  // technician signs in elsewhere). Verify the token is still LIVE before
  // rendering the signed-in shell — otherwise a dead session would show
  // "Signed in — <name>" over orders that 401. A null result = dead token.
  const jobs = await fetchTechnicianJobs(me.pockitToken ?? "", me.user.id);
  if (jobs === null) redirect("/login?expired=1");
  return <OrdersClient technicianName={me.user.name} />;
}
