"use client";

import { useEffect, useRef, useState } from "react";

export function CountUp({ target, durationMs = 900 }: { target: number; durationMs?: number }) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setValue(target);
      return;
    }
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
  }, [target, durationMs]);

  return <span className="tabular-nums">{value.toLocaleString()}</span>;
}
