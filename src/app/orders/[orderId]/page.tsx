import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { getOrder } from "@/lib/accounts";
import { ConsentClient } from "./ConsentClient";

export default async function ConsentPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login");
  if (me.role !== "technician") redirect("/login");
  const { orderId } = await params;
  const order = getOrder(orderId);
  if (!order || order.assignedTechnicianId !== me.user.id) redirect("/orders");
  return <ConsentClient order={order} />;
}
