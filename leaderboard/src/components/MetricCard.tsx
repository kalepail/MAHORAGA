import { InfoIcon } from "./Tooltip";

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  tooltip?: string;
}

export function MetricCard({ label, value, sub, positive, tooltip }: MetricCardProps) {
  const valueColor =
    positive === undefined
      ? "text-hud-text-bright"
      : positive
        ? "text-hud-success"
        : "text-hud-error";

  return (
    <div className="hud-panel p-4">
      <div className="hud-label mb-2 flex items-center gap-1.5">
        {label}
        {tooltip && <InfoIcon tooltip={tooltip} />}
      </div>
      <div className={`hud-value-lg ${valueColor}`}>{value}</div>
      {sub && <div className="hud-label mt-1">{sub}</div>}
    </div>
  );
}
