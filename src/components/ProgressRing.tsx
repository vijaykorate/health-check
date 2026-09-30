"use client";

import { useEffect, useRef, useState } from "react";

export function ProgressRing({
  percent,
  label,
}: {
  percent: number;
  label?: string;
}) {
  const size = 168;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(100, percent));

  // Animate the shown value toward the target so a jump (e.g. 0 → 58) counts up
  // smoothly instead of snapping straight to the number. Eases each frame and
  // settles exactly on the target.
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cur = shownRef.current;
      const diff = target - cur;
      if (Math.abs(diff) <= 0.4) {
        shownRef.current = target;
        setShown(target);
        return;
      }
      const next = cur + diff * 0.12;
      shownRef.current = next;
      setShown(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const clamped = Math.max(0, Math.min(100, shown));
  const offset = c - (clamped / 100) * c;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-bold text-foreground">
          {Math.round(clamped)}%
        </span>
        {label ? (
          <span className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
