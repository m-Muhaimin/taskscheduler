import Link from "next/link";
import { ArrowUpRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";
import { Sparkline } from "./sparkline";

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
  /** Where the card navigates to. */
  href?: string;
  delayMs?: number;
}

const TONE_COLOR: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "var(--accent)",
  success: "var(--success)",
  danger: "var(--danger)",
};

function TrendIcon({ direction }: { direction: MetricTrend["direction"] }) {
  const size = 12;
  if (direction === "up") return <TrendingUp size={size} aria-hidden="true" />;
  if (direction === "down") return <TrendingDown size={size} aria-hidden="true" />;
  return <Minus size={size} aria-hidden="true" />;
}

export function MetricCard({
  label,
  value,
  prefix,
  suffix,
  tone = "default",
  trend,
  chartData,
  href,
  delayMs = 0,
}: MetricCardProps) {
  const color = TONE_COLOR[tone];
  const className =
    "card metric-card-rise group relative block p-4 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card";
  const style = { animationDelay: `${delayMs}ms` };

  const body = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[12px] text-ink-muted leading-tight">{label}</p>
        {href && (
          <ArrowUpRight
            size={14}
            aria-hidden="true"
            className="shrink-0 text-ink-faint opacity-0 -translate-x-1 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 group-focus-visible:opacity-100"
          />
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-5">
        <p className="font-mono text-[24px] font-medium leading-none" style={{ color: tone !== "default" ? color : undefined }}>
          {prefix}
          <CountUp target={value} />
          {suffix}
        </p>
        {trend && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium font-mono"
            style={{ color: trend.good ? "var(--success)" : "var(--danger)" }}
          >
            <TrendIcon direction={trend.direction} />
            {trend.deltaLabel}
          </span>
        )}
      </div>

      <Sparkline
        values={chartData}
        color={color}
        height={44}
        delayMs={delayMs}
        prefix={prefix}
        suffix={suffix}
        ariaLabel={`${label} trend over the last ${chartData.length} days`}
      />
    </>
  );

  return href ? (
    <Link href={href} className={className} style={style}>
      {body}
    </Link>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}
