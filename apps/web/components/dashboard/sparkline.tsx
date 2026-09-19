"use client";

import { useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

interface SparklineProps {
  values: number[];
  color: string;
  /** Pixel height of the chart area. */
  height?: number;
  /** Delay before the draw-in starts (stagger across cards). */
  delayMs?: number;
  strokeWidth?: number;
  /** Wrapped around the value in the hover tooltip, e.g. "$" / " recovered". (Strings, so server components can pass them.) */
  prefix?: string;
  suffix?: string;
  /** Background the end-dot's ring should blend with. */
  ringColor?: string;
  ariaLabel: string;
}

const VB_W = 100;
const VB_H = 40;
const PAD = 3;

/**
 * Responsive sparkline with a reveal animation and pointer scrubbing.
 * The end dot is an HTML element, not an SVG circle, so the stretched viewBox
 * (preserveAspectRatio="none") can't squash it into an ellipse.
 */
export function Sparkline({
  values,
  color,
  height = 44,
  delayMs = 0,
  strokeWidth = 1.75,
  prefix = "",
  suffix = "",
  ringColor,
  ariaLabel,
}: SparklineProps) {
  const gradientId = `spark-${useId().replace(/:/g, "")}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: (i / (n - 1)) * VB_W,
    y: VB_H - PAD - ((v - min) / range) * (VB_H - PAD * 2),
    v,
  }));
  const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `0,${VB_H} ${line} ${VB_W},${VB_H}`;
  const shown = active ?? n - 1;

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setActive(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
  }

  const vars = {
    height,
    "--spark-delay": `${delayMs}ms`,
    ...(ringColor ? { "--spark-ring": ringColor } : {}),
  } as CSSProperties;

  return (
    <div
      ref={boxRef}
      className="spark"
      style={vars}
      data-active={active !== null}
      role="img"
      aria-label={ariaLabel}
      onPointerMove={onMove}
      onPointerLeave={() => setActive(null)}
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="spark-svg" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span className="spark-guide" style={{ left: `${pts[shown].x}%` }} />
      <span
        className="spark-dot"
        style={{ left: `${pts[shown].x}%`, top: `${(pts[shown].y / VB_H) * 100}%`, background: color }}
      />
      {active !== null && (
        <span className="spark-tip" style={{ left: `clamp(28px, ${pts[active].x}%, calc(100% - 28px))` }}>
          {prefix}
          {pts[active].v.toLocaleString("en-US")}
          {suffix}
        </span>
      )}
    </div>
  );
}
