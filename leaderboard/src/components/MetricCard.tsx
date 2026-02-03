interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}

export function MetricCard({ label, value, sub, positive }: MetricCardProps) {
  const valueColor =
    positive === undefined
      ? "text-hud-text-bright"
      : positive
        ? "text-hud-success"
        : "text-hud-error";

  return (
    <div className="hud-panel p-4">
      <div className="hud-label mb-2">{label}</div>
      <div className={`hud-value-lg ${valueColor}`}>{value}</div>
      {sub && <div className="hud-label mt-1">{sub}</div>}
    </div>
  );
}
