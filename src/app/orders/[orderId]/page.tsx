import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { StartHealthCheck } from "./StartHealthCheck";

export default async function OrderStartPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login");
  if (me.role !== "technician") redirect("/login");
  const { orderId } = await params;
  // The session is created via POST (not here) so navigation/prefetch has no
  // side effects; the client component starts the health check and forwards
  // to the wizard.
  return <StartHealthCheck orderId={orderId} />;
}
