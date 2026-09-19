"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Compact fetch-failure card with a retry button. Rendered wherever a
 * dashboard fetch throws (5xx / network) so an API hiccup never leaves a
 * blank page — one click re-runs the same loader.
 */
export function ErrorState({
  message,
  onRetry,
  label = "this section",
}: {
  message: string;
  onRetry: () => void;
  label?: string;
}) {
  return (
    <div role="alert" className="fade-in card flex flex-col items-center gap-2 text-center py-10 px-4">
      <AlertTriangle size={20} style={{ color: "var(--danger)" }} aria-hidden="true" />
      <p className="text-[13px] text-ink font-medium">Couldn&apos;t load {label}</p>
      <p className="text-[12.5px] text-ink-muted max-w-[44ch] leading-relaxed">{message}</p>
      <button type="button" onClick={onRetry} className="btn btn-ghost btn-sm mt-2">
        Try again
      </button>
    </div>
  );
}