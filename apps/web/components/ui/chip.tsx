import type { ReactNode } from "react";
import clsx from "clsx";

export type ChipTone = "danger" | "success" | "muted";

// Literal class names (not `chip-${tone}`) so Tailwind's content scanner keeps them.
const TONE_CLASS: Record<ChipTone, string> = {
  danger: "chip-danger",
  success: "chip-success",
  muted: "chip-muted",
};

interface ChipProps {
  tone?: ChipTone;
  /** Adds a live pulsing dot (something is happening right now). */
  live?: boolean;
  children: ReactNode;
  className?: string;
}

/** Status pill. One implementation for inbox rows, jobs, the auth aside and the landing mock-ups. */
export function Chip({ tone = "muted", live, children, className }: ChipProps) {
  return (
    <span className={clsx("chip", TONE_CLASS[tone], className)}>
      {live && <span className="pulse-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
