interface SparklineProps {
  data: number[];
  width?: number | "100%";
  height?: number;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Color follows the visual direction: last vs first data point
  const positive = data[data.length - 1] >= data[0];

  // Use a fixed internal coordinate system; viewBox handles scaling
  const svgWidth = typeof width === "number" ? width : 200;

  const coords = data.map((value, i) => ({
    x: (i / (data.length - 1)) * svgWidth,
    y: height - ((value - min) / range) * height,
  }));

  const points = coords.map((c) => `${c.x},${c.y}`).join(" ");

  // Build a closed polygon for the gradient fill area
  const fillPoints =
    points +
    ` ${coords[coords.length - 1].x},${height}` +
    ` ${coords[0].x},${height}`;

  const color = positive ? "var(--color-hud-success)" : "var(--color-hud-error)";
  const gradId = `spark-grad-${positive ? "up" : "down"}`;

  return (
    <svg
      width={width === "100%" ? "100%" : width}
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      preserveAspectRatio={width === "100%" ? "none" : undefined}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#${gradId})`} />
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
