import { BrandMark } from "@/components/Brand";
import { ConnectClient } from "./ConnectClient";

// Customer entry point — no login/CRM. The customer enters the 6-digit code
// their technician read out; Next.js forwards it to the existing Pockit
// backend pairing endpoint, which connects them to the ONE shared Health
// Check session.
export default function Connect() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 py-12">
      <div className="flex items-center gap-3">
        <BrandMark />
        <span className="text-sm text-muted">Health Check</span>
      </div>
      <ConnectClient />
    </main>
  );
}
