interface SkeletonProps {
  className?: string;
}

/**
 * Shimmer placeholder block. Callers size it via className
 * (e.g. "h-12 w-full", "h-4 w-24 rounded-[10px]"). The shimmer sweep lives in
 * globals.css (.skeleton) and is disabled under prefers-reduced-motion.
 * Hidden from assistive tech — real content replaces it.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={"skeleton " + (className ?? "")} />;
}