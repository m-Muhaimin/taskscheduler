"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { InboxItem } from "@/lib/types";
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips";
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

  function handleResolve(id: string) {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      onCountChange?.(next.filter((i) => i.state === "attention").length);
      return next;
    });
  }

  const options: ChipOption<Filter>[] = useMemo(
    () => [
      { value: "all", label: "All", count: items.length },
      { value: "attention", label: "Needs attention", count: items.filter((i) => i.state === "attention").length },
      { value: "handled", label: "Handled", count: items.filter((i) => i.state === "handled").length },
    ],
    [items]
  );

  const visible = useMemo(() => {
    const base = compact ? items.slice(0, 4) : items;
    if (filter === "all") return base;
    return base.filter((i) => i.state === filter);
  }, [items, filter, compact]);

  return (
    <div>
      {showFilters && (
        <div className="mb-3">
          <FilterChips options={options} value={filter} onChange={setFilter} label="Filter conversations" />
        </div>
      )}

      {visible.length > 0 && (
        <div className="card overflow-hidden divided">
          {visible.map((item, i) => (
            <InboxRow key={item.id} item={item} compact={compact} index={i} onResolve={handleResolve} />
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <div className="fade-in flex flex-col items-center gap-2 text-center text-[13px] text-ink-muted py-10 px-4 card">
          <CheckCircle2 size={20} style={{ color: "var(--success)" }} aria-hidden="true" />
          <p>Nothing here right now {"\u2014"} the AI is quietly running your front desk.</p>
        </div>
      )}
    </div>
  );
}
