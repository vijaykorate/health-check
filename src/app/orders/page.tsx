import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { OrdersClient } from "./OrdersClient";

export default async function OrdersPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  return <OrdersClient technicianName={me.user.name} />;
}
