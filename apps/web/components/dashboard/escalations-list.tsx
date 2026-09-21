"use client";

import { useMemo, useState } from "react";
import type { EscalationItem } from "@/lib/types";
import { Chip } from "@/components/ui/chip";
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips";

type StatusFilter = "all" | EscalationItem["status"];

/** Filterable escalation rows (pending first, as the API sorts them). Read-only per plan Decision 1. */
export function EscalationsList({ escalations }: { escalations: EscalationItem[] }) {
  const [status, setStatus] = useState<StatusFilter>("all");

  const options: ChipOption<StatusFilter>[] = useMemo(
    () => [
      { value: "all", label: "All", count: escalations.length },
      { value: "pending", label: "Pending", count: escalations.filter((e) => e.status === "pending").length },
      { value: "resolved", label: "Resolved", count: escalations.filter((e) => e.status === "resolved").length },
    ],
    [escalations]
  );

  const filtered = useMemo(
    () => (status === "all" ? escalations : escalations.filter((e) => e.status === status)),
    [escalations, status]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-4">
        <p className="text-[12.5px] text-ink-muted" aria-live="polite">
          {filtered.length} of {escalations.length} escalations
        </p>
        <FilterChips options={options} value={status} onChange={setStatus} label="Filter escalations by status" />
      </div>

      <div className="card overflow-hidden divided">
        {filtered.map((e, i) => (
          <div
            key={e.id}
            className="metric-card-rise flex items-center gap-4 px-4 py-3 hover:bg-surface-2 transition-colors"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <Chip tone={e.status === "pending" ? "danger" : "success"} live={e.status === "pending"}>
                  {e.status === "pending" ? "Pending" : "Resolved"}
                </Chip>
                <Chip tone="muted">{e.typeLabel}</Chip>
              </div>
              <p className="text-[12px] text-ink-muted font-mono">{e.customerPhone}</p>
              {e.content && (
                <p className="text-[13px] truncate max-w-[56ch]" title={e.content}>
                  {e.content}
                </p>
              )}
              {e.messageSid && (
                <p className="text-[11px] text-ink-faint font-mono mt-1">{e.messageSid}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] text-ink-faint">{e.createdAtDisplay}</p>
              {e.resolvedAtDisplay && <p className="text-[11px] text-ink-faint">resolved {e.resolvedAtDisplay}</p>}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="text-center text-[13px] text-ink-muted py-8">No escalations with this status.</p>
        )}
      </div>
    </div>
  );
}