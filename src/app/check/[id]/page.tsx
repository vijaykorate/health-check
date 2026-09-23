import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session-auth";
import { verifyOrderToken } from "@/lib/customer-token";
import { CheckClient } from "./CheckClient";
import { CustomerConsentClient } from "./CustomerConsentClient";

export default async function CheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // Customer WebView mode (opened from the Pockit app: ?customer=1&t=<token>).
  // The customer has NO technician session — never redirect them to /login;
  // render the customer consent screen instead.
  if (sp.customer === "1") {
    const t = typeof sp.t === "string" ? sp.t : "";
    const claim = verifyOrderToken(t);
    if (!claim) {
      return (
        <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
          <div className="font-display text-lg font-semibold text-foreground">
            This consent link has expired
          </div>
          <p className="mt-2 text-sm text-muted">
            Please reopen the Health Check from your Pockit app.
          </p>
        </main>
      );
    }
    return <CustomerConsentClient orderId={claim.orderId} token={t} />;
  }

  // Technician view.
  const me = await currentUser();
  if (!me) redirect("/login");
  return <CheckClient id={id} />;
}
