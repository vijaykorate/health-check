import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { CheckClient } from "./CheckClient";

export default async function CheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;
  return <CheckClient id={id} />;
}
