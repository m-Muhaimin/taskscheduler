"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/lib/hooks";

interface CountUpProps {
  target: number;
  durationMs?: number;
  /** Wait until scrolled into view before counting (marketing sections). */
  startOnView?: boolean;
  className?: string;
}

/** Animated number. Snaps straight to the target under prefers-reduced-motion. */
export function CountUp({ target, durationMs = 900, startOnView = false, className }: CountUpProps) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const [viewRef, inView] = useInView<HTMLSpanElement>();
  const go = !startOnView || inView;

  useEffect(() => {
    if (!go) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    startRef.current = null;
    let frame: number;
    function step(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const progress = Math.min((ts - startRef.current) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, go]);

  return (
    <span ref={viewRef} className={`tabular-nums ${className ?? ""}`}>
      {value.toLocaleString("en-US")}
    </span>
  );
}
