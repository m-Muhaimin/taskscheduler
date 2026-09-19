import type { CSSProperties } from "react";
import { CountUp } from "@/components/ui/count-up";
import { Sparkline } from "./sparkline";

const TONE_COLOR = {
  default: "var(--accent)",
  success: "var(--success)",
  danger: "var(--danger)",
} as const;

export type SeriesTone = keyof typeof TONE_COLOR;

interface AnalyticsSeriesCardProps {
  title: string;
  /** 30-day daily series, oldest -> newest. */
  values: number[];
  /** What the headline number shows: sum (revenue/bookings/cost) or mean (rate). */
  aggregate?: "sum" | "mean";
  prefix?: string; // e.g. "$"
  suffix?: string; // e.g. "%"
  tone?: SeriesTone;
  /** Render mini bars instead of a sparkline line. */
  bar?: boolean;
  delayMs?: number;
  ariaLabel: string;
}

function headValue(values: number[], aggregate: "sum" | "mean"): number {
  if (values.length === 0) return 0;
  if (aggregate === "mean") {
    return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  }
  return values.reduce((s, v) => s + v, 0);
}

function tooltipValue(v: number, prefix?: string, suffix?: string): string {
  return `${prefix ?? ""}${v.toLocaleString("en-US")}${suffix ?? ""}`;
}

/**
 * 30-day analytics series card — the four new metrics (revenue, bookings,
 * AI booking rate, AI cost). Reuses the card/Skeleton/CountUp/Sparkline
 * primitives and the metric-card-rise / bar-grow animation conventions.
 */
export function AnalyticsSeriesCard({
  title,
  values,
  aggregate = "sum",
  prefix,
  suffix,
  tone = "default",
  bar,
  delayMs = 0,
  ariaLabel,
}: AnalyticsSeriesCardProps) {
  const color = TONE_COLOR[tone];
  const head = headValue(values, aggregate);
  const max = values.length ? Math.max(...values) : 0;

  return (
    <div className="card p-5 metric-card-rise" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-[12.5px] font-medium">{title}</h3>
        <p
          className="font-mono text-[20px] font-medium leading-none tabular-nums"
          style={{ color: tone !== "default" ? color : undefined }}
        >
          {prefix}
          <CountUp target={head} durationMs={900} />
          {suffix}
        </p>
      </div>

      {max === 0 ? (
        <div
          className="flex items-center justify-center h-20 rounded-[6px] border border-dashed border-border"
          style={bar ? undefined : { height: 48 }}
        >
          <span className="text-[11px] text-ink-faint">No data yet</span>
        </div>
      ) : bar ? (
        <div
          className="bars flex items-end gap-[2px] h-20"
          role="img"
          aria-label={ariaLabel}
        >
          {values.map((v, i) => {
            const h = Math.max(4, Math.round((v / max) * 100));
            return (
              <div key={i} className="bar-wrap relative flex-1 h-full flex items-end">
                <div
                  className="bar bar-grow w-full rounded-t-[3px]"
                  style={
                    {
                      height: `${h}%`,
                      background: color,
                      "--o": 0.45 + (h / 100) * 0.55,
                      animationDelay: `${delayMs + i * 14}ms`,
                    } as CSSProperties
                  }
                />
                <div className="bar-tooltip absolute left-1/2 px-1.5 py-0.5 rounded-[5px] text-[10px] font-mono bg-surface border border-border-strong whitespace-nowrap z-10" style={{ bottom: `calc(${h}% + 6px)` }}>
                  {tooltipValue(v, prefix, suffix)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Sparkline
          values={values}
          color={color}
          height={48}
          strokeWidth={1.75}
          delayMs={delayMs}
          prefix={prefix}
          suffix={suffix}
          ariaLabel={ariaLabel}
        />
      )}
    </div>
  );
}