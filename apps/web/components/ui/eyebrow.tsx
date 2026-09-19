import type { ReactNode } from "react";

interface EyebrowProps {
  className?: string;
  children: ReactNode;
}

/**
 * Mono uppercase tracking label used for section/block eyebrows.
 */
export function Eyebrow({ className, children }: EyebrowProps) {
  return (
    <p className={"font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted " + (className ?? "")}>
      {children}
    </p>
  );
}