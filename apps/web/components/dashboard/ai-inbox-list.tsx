"use client";

import { useMemo, useState } from "react";
import type { InboxItem, InboxState } from "@/lib/types";
import { InboxRow } from "./inbox-row";

type Filter = "all" | "attention" | "handled";

interface AiInboxListProps {
  items: InboxItem[];
  compact?: boolean;
  showFilters?: boolean;
  onCountChange?: (attentionCount: number) => void;
}

export function AiInboxList({ items: initialItems, compact, showFilters, onCountChange }: AiInboxListProps) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<Filter>("all");

  function handleResolve(id: number) {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      const attentionCount = next.filter((i) => i.state === "attention").length;
      onCountChange?.(attentionCount);
      return next;
    });
  }

  const visible = useMemo(() => {
    const base = compact ? items.slice(0, 4) : items;
    if (filter === "all") return base;
    if (filter === "attention") return base.filter((i) => i.state === "attention");
    return base.filter((i) => i.state === "handled");
  }, [items, filter, compact]);

  return (
    <div>
      {showFilters && (
        <div className="flex gap-1.5 text-[12px] mb-3">
          {(["all", "attention", "handled"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[12.5px] font-medium px-3 py-1.5 rounded-[8px] border transition-colors ${
                filter === f
                  ? "bg-accent text-accent-ink border-transparent"
                  : "border-border-strong hover:bg-surface-2"
              }`}
            >
              {f === "all" ? "All" : f === "attention" ? "Needs attention" : "Handled"}
            </button>
          ))}
        </div>
      )}

      <div className="border border-border rounded-[10px] bg-surface overflow-hidden [&>*+*]:border-t [&>*+*]:border-border">
        {visible.map((item: InboxItem, i: number) => (
          <InboxRow key={item.id} item={item} compact={compact} index={i} onResolve={handleResolve} />
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-center text-sm text-ink-muted py-10 border border-border rounded-[10px] mt-4">
          Nothing here right now {"\u2014"} the AI is quietly running your front desk.
        </p>
      )}
    </div>
  );
}
