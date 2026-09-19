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
      className="animate-rise flex items-start gap-2.5 p-3 rounded-[10px] border border-border text-[13px] leading-snug"
      style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
    >
      <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
