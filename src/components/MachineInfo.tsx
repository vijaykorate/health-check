import type { Machine } from "@/lib/types";

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export function MachineInfo({ machine }: { machine: Machine }) {
  const ram =
    machine.RAM_GB != null ? `${machine.RAM_GB} GB` : undefined;
  return (
    <div className="card p-5">
      <h3 className="font-display text-lg font-semibold text-foreground">
        Machine
      </h3>
      <div className="mt-3">
        <Row label="Manufacturer" value={machine.Manufacturer} />
        <Row label="Model" value={machine.Model} />
        <Row label="Form factor" value={machine.FormFactor} />
        <Row label="CPU" value={machine.CPU} />
        <Row label="Memory" value={ram} />
        <Row label="Storage" value={machine.StorageModel ?? undefined} />
        <Row label="OS" value={machine.OS} />
        <Row label="OS version" value={machine.OSVersion} />
        <Row label="Architecture" value={machine.Architecture} />
        <Row label="BIOS" value={machine.BIOS} />
        <Row label="Serial number" value={machine.SerialNumber} />
      </div>
    </div>
  );
}
