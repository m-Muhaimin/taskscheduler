"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { JobRow } from "@/lib/types";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips";

type StatusFilter = "all" | JobRow["status"];
type SortKey = "customer" | "value";
type SortDir = "asc" | "desc";

const STATUS_TONE: Record<JobRow["status"], ChipTone> = {
  Completed: "success",
  "Needs dispatch": "danger",
  Scheduled: "muted",
  "In progress": "muted",
};

const STATUS_ORDER: JobRow["status"][] = ["Needs dispatch", "In progress", "Scheduled", "Completed"];

/** "$180" -> 180, "—" -> null (sorts last either way). */
function dollars(value: string): number | null {
  const n = parseInt(value.replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      className={`font-medium px-4 py-2.5 ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex items-center gap-1 uppercase tracking-wide rounded-[4px] hover:text-ink transition-colors ${
          active ? "text-ink" : ""
        }`}
      >
        {label}
        <Icon
          size={11}
          aria-hidden="true"
          className={active ? "" : "opacity-50 group-hover:opacity-100 transition-opacity"}
        />
      </button>
    </th>
  );
}

export function JobsTable({ jobs }: { jobs: JobRow[] }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  function onSort(key: SortKey) {
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));
  }

  const options: ChipOption<StatusFilter>[] = useMemo(
    () => [
      { value: "all", label: "All", count: jobs.length },
      ...STATUS_ORDER.map((s) => ({ value: s, label: s, count: jobs.filter((j) => j.status === s).length })),
    ],
    [jobs]
  );

  const rows = useMemo(() => {
    const filtered = status === "all" ? jobs : jobs.filter((j) => j.status === status);
    if (!sort) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "customer") return a.customer.localeCompare(b.customer) * dir;
      const av = dollars(a.value);
      const bv = dollars(b.value);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [jobs, status, sort]);

  return (
    <div>
      <div className="mb-3">
        <FilterChips options={options} value={status} onChange={setStatus} label="Filter jobs by status" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-ink-faint text-[11px] uppercase tracking-wide border-b border-border">
                <SortHeader
                  label="Customer"
                  sortKey="customer"
                  active={sort?.key === "customer"}
                  dir={sort?.dir ?? "asc"}
                  onSort={onSort}
                />
                <th scope="col" className="font-medium px-4 py-2.5">Service</th>
                <th scope="col" className="font-medium px-4 py-2.5">Technician</th>
                <th scope="col" className="font-medium px-4 py-2.5">Status</th>
                <SortHeader
                  label="Value"
                  sortKey="value"
                  active={sort?.key === "value"}
                  dir={sort?.dir ?? "asc"}
                  onSort={onSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody className="divided">
              {rows.map((job, i) => (
                <tr
                  key={job.id}
                  className="hover:bg-surface-2 transition-colors metric-card-rise"
                  style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                >
                  <td className="px-4 py-2.5 font-medium">{job.customer}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{job.service}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{job.technician}</td>
                  <td className="px-4 py-2.5">
                    <Chip tone={STATUS_TONE[job.status]} live={job.status === "In progress"}>
                      {job.status}
                    </Chip>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{job.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="text-center text-[13px] text-ink-muted py-8">No jobs with this status.</p>
        )}
      </div>
    </div>
  );
}
