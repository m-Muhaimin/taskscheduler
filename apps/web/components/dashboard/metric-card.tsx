import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { CountUp } from "./count-up";

export interface MetricTrend {
  deltaLabel: string; // e.g. "+18% vs last week"
  direction: "up" | "down" | "flat";
  good: boolean; // whether this direction is a good thing for this metric
}

export interface MetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  tone?: "default" | "success" | "danger";
  trend?: MetricTrend;
  chartData: number[];
  delayMs?: number;
}

const TONE_COLOR: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "var(--accent)",
  success: "var(--success)",
  danger: "var(--danger)",
};

function toPoints(values: number[], width: number, height: number, padY = 4) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  return values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - padY * 2) - padY;
    return { x, y };
  });
}

function TrendIcon({ direction }: { direction: MetricTrend["direction"] }) {
  const size = 12;
  if (direction === "up") return <TrendingUp size={size} />;
  if (direction === "down") return <TrendingDown size={size} />;
  return <Minus size={size} />;
}

export function MetricCard({
  label,
  value,
  prefix,
  suffix,
  tone = "default",
  trend,
  chartData,
  delayMs = 0,
}: MetricCardProps) {
  const color = TONE_COLOR[tone];
  const width = 160;
  const height = 44;
  const points = toPoints(chartData, width, height);
  const linePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;
  const gradientId = `metric-grad-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div
      className="group relative border border-border rounded-[10px] bg-surface p-4 metric-card-rise transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-border-strong"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-[12px] text-ink-muted">{label}</p>
        {trend && (
          <span
            className="flex items-center gap-1 text-[11px] font-medium font-mono shrink-0"
            style={{ color: trend.good ? "var(--success)" : "var(--danger)" }}
          >
            <TrendIcon direction={trend.direction} />
            {trend.deltaLabel}
          </span>
        )}
      </div>

      <p className="font-mono text-[24px] font-medium leading-none mb-3" style={{ color: tone !== "default" ? color : undefined }}>
        {prefix}
        <CountUp target={value} />
        {suffix}
      </p>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-11 overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill={`url(#${gradientId})`} className="metric-area-fade" style={{ animationDelay: `${delayMs + 200}ms` }} />
        <polyline
          points={linePoints}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="metric-line-draw"
          style={{ animationDelay: `${delayMs}ms` }}
        />
        {points.map((p, i) =>
          i === points.length - 1 ? (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={2.5}
              fill={color}
              className="metric-dot-pop"
              style={{ animationDelay: `${delayMs + 650}ms` }}
            />
          ) : null
        )}
      </svg>
    </div>
  );
}
