// Shared Pockit Engineers brand mark — the orange PE shield + wordmark, used
// across the app so every surface matches the Pockit Technician App.

// The official Pockit Engineers PE shield. Source asset lives at
// public/Assets/pe-logo.png and is served at /Assets/pe-logo.png.
export function PockitShield({ className = "h-7 w-auto" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/Assets/pe-logo.png" alt="Pockit Engineers" className={className} />;
}

export function PockitWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-extrabold tracking-tight ${className}`}>
      <span className="text-brand">Pock</span>
      <span className="text-accent">it</span>
      <span className="text-brand"> Engineers</span>
    </span>
  );
}

/** Compact shield + wordmark for page headers. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <PockitShield className="h-7 w-auto" />
      <PockitWordmark className="text-sm" />
    </div>
  );
}
