"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";

interface FaqItem {
  q: string;
  a: string;
}

/** One-open-at-a-time accordion. Height animates via the shared .expandable primitive. */
export function FaqList({ items }: { items: readonly FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const base = useId();

  return (
    <div className="border-b border-border-strong">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className="border-t border-border-strong">
            <h3>
              <button
                type="button"
                id={`${base}-q${i}`}
                aria-expanded={isOpen}
                aria-controls={`${base}-a${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-4 py-3.5 min-h-[44px] text-left rounded-[8px] transition-colors hover:text-accent-deep"
              >
                <span className="text-[15px] font-medium leading-snug">{item.q}</span>
                <Plus size={17} className="faq-plus shrink-0 text-ink-muted" aria-hidden="true" />
              </button>
            </h3>
            <div id={`${base}-a${i}`} role="region" aria-labelledby={`${base}-q${i}`} className="expandable" data-collapsed={!isOpen}>
              <div className="expandable-inner">
                <p className="text-[14px] leading-[1.6] text-ink-muted pb-4 max-w-[60ch]">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
