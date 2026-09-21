import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { LoginClient } from "./LoginClient";

export default async function LoginPage() {
  const me = await currentUser();
  if (me) redirect("/orders");
  return <LoginClient />;
}
