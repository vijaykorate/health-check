import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";

// The app's front door is the login page. Signed-in users go straight to work.
export default async function Home() {
  const me = await currentUser();
  redirect(me ? "/orders" : "/login");
}
