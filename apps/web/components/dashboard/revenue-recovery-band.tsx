"use client";

import { useId, useState } from "react";
import { TrendingUp } from "lucide-react";

interface RevenueRecoveryBandProps {
  missedCalls: number;
  recovered: number;
  booked: number;
  estimatedRevenue: number;
  sparkline: number[]; // oldest -> newest
}

const WIDTH = 240;
const HEIGHT = 72;
const PAD = 6;

function toPoints(values: number[]) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = WIDTH / (values.length - 1);
  return values.map((v, i) => ({
    x: i * step,
    y: HEIGHT - ((v - min) / range) * (HEIGHT - PAD * 2) - PAD,
    value: v,
  }));
}

export function RevenueRecoveryBand({
  missedCalls,
  recovered,
  booked,
  estimatedRevenue,
  sparkline,
}: RevenueRecoveryBandProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId();
  const points = toPoints(sparkline);
  const linePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPoints = `0,${HEIGHT} ${linePoints} ${WIDTH},${HEIGHT}`;

  return (
    <div
      className="mt-7 rounded-[10px] p-5 md:p-6 animate-rise"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        <div className="md:w-56 shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="font-head font-semibold text-[15px]">AI revenue recovery</p>
            <TrendingUp size={14} style={{ color: "var(--success)" }} />
          </div>
          <p className="text-[12.5px] text-ink-muted leading-relaxed">
            Missed calls the AI turned back into booked jobs this month.
          </p>
        </div>

        <div className="flex-1 flex flex-wrap gap-x-8 gap-y-3">
          <Stat value={missedCalls} label="missed calls" />
          <Divider />
          <Stat value={recovered} label="recovered" />
          <Divider />
          <Stat value={booked} label="booked" />
          <Divider className="hidden sm:block" />
          <Stat value={`~$${estimatedRevenue.toLocaleString()}`} label="estimated recovered revenue" accent />
        </div>

        <div className="relative w-full md:w-60 h-[72px] shrink-0">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full h-full overflow-visible"
            preserveAspectRatio="none"
            onMouseLeave={() => setHovered(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={areaPoints} fill={`url(#${gradientId})`} className="metric-area-fade" />
            <polyline
              className="sparkline-path"
              points={linePoints}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <g key={i}>
                {/* generous invisible hit target for hover, since dots are tiny */}
                <rect
                  x={p.x - WIDTH / points.length / 2}
                  y={0}
                  width={WIDTH / points.length}
                  height={HEIGHT}
                  fill="transparent"
                  onMouseEnter={() => setHovered(i)}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hovered === i ? 4 : 2.5}
                  fill="var(--accent)"
                  stroke="var(--surface-2)"
                  strokeWidth={hovered === i ? 2 : 0}
                  className="transition-all duration-150"
                />
              </g>
            ))}
          </svg>

          {hovered !== null && (
            <div
              className="absolute -top-1 px-2 py-1 rounded-[6px] text-[11px] font-mono bg-surface border border-border-strong shadow-sm pointer-events-none -translate-x-1/2 -translate-y-full"
              style={{ left: `${(points[hovered].x / WIDTH) * 100}%` }}
            >
              {points[hovered].value} recovered
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-ink-faint mt-4 pt-4 border-t border-border">
        Estimate based on average job value for recovered conversations {"\u2014"} not yet confirmed
        against actual payments.
      </p>
    </div>
  );
}

function Stat({ value, label, accent }: { value: number | string; label: string; accent?: boolean }) {
  return (
    <div>
      <p
        className="font-mono text-[20px] font-medium leading-none"
        style={{ color: accent ? "var(--accent)" : undefined }}
      >
        {value}
      </p>
      <p className="text-[11.5px] text-ink-muted mt-1">{label}</p>
    </div>
  );
}

function Divider({ className = "" }: { className?: string }) {
  return <div className={`w-px self-stretch bg-border ${className}`} />;
}
