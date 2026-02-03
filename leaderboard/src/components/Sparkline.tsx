interface SparklineProps {
  data: number[];
  width?: number | "100%";
  height?: number;
  positive?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  positive = true,
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Use a fixed internal coordinate system; viewBox handles scaling
  const svgWidth = typeof width === "number" ? width : 200;

  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * svgWidth;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const color = positive ? "var(--color-hud-success)" : "var(--color-hud-error)";

  return (
    <svg
      width={width === "100%" ? "100%" : width}
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      preserveAspectRatio={width === "100%" ? "none" : undefined}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
