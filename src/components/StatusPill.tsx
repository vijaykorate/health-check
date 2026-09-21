import type { CheckStatus } from "@/lib/types";
import { checkTone, toneClasses } from "@/lib/ui";

export function StatusPill({ status }: { status: CheckStatus }) {
  const tone = checkTone(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}
    >
      {status}
    </span>
  );
}
