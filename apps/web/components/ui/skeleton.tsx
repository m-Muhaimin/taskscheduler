import clsx from "clsx";
import type { CSSProperties } from "react";

/** Shimmering placeholder block. Size it with Tailwind (h-3 w-24 …). Purely visual. */
export function Skeleton({
  className,
  style,
  strong,
}: {
  className?: string;
  style?: CSSProperties;
  /** Use on surface-2 backgrounds, where the default shimmer would disappear. */
  strong?: boolean;
}) {
  return <span aria-hidden="true" className={clsx("skeleton", strong && "skeleton-strong", className)} style={style} />;
}
