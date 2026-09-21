import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { DashboardClient } from "./DashboardClient";

export default async function DashboardPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  return <DashboardClient />;
}
