"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

/** Form-level error. Takes focus when it appears so screen readers and keyboard users land on it. */
export function FormAlert({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [message]);

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="flex items-start gap-3 p-3 rounded-[10px] border border-border text-[14px] leading-snug"
      style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
    >
      <AlertTriangle size={16} className="shrink-0 mt-1" />
      <p>{message}</p>
    </div>
  );
}
