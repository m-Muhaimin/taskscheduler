import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/** Title + description + optional actions. Every dashboard page opens with one. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 mb-4">
      <div className="min-w-0">
        <h2 className="font-head font-semibold text-[15px]">{title}</h2>
        {description && <p className="text-[12.5px] text-ink-muted mt-0.5">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** A block heading with a "view all" style link on the right. */
export function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-head font-semibold text-[15px]">{title}</h2>
      {href && (
        <Link
          href={href}
          className="group inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink transition-colors rounded-[6px]"
        >
          {linkLabel}
          <ArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
