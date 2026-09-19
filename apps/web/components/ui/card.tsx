import type { ReactNode } from "react";

interface CardProps {
  className?: string;
  children: ReactNode;
}

/**
 * Presentational card surface. Mirrors the dashboard settings SectionCard
 * pattern (max-w-xl border rounded bg-surface [&>*+*]:border-t) without the
 * section heading — callers compose a Card with DividerRow children.
 */
export function Card({ className, children }: CardProps) {
  return (
    <div className={"border border-border rounded-[10px] bg-surface " + (className ?? "")}>{children}</div>
  );
}

interface DividerRowProps {
  className?: string;
  children: ReactNode;
}

/**
 * Row inside a Card with a top divider, except for the first child
 * (first:border-t-0). Padding matches the settings row rhythm (px-5 py-4).
 */
export function DividerRow({ className, children }: DividerRowProps) {
  return (
    <div className={"px-5 py-4 border-t border-border first:border-t-0 " + (className ?? "")}>
      {children}
    </div>
  );
}