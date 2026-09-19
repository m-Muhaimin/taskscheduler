import { Skeleton } from "@/components/ui/skeleton";

/* Each skeleton mirrors the dimensions of the widget it stands in for, so nothing jumps when content arrives. */

export function MetricGridSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-7">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-6 w-16 mb-5" />
          <Skeleton className="h-11 w-full rounded-[8px]" />
        </div>
      ))}
    </div>
  );
}

export function InboxListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden divided">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3" style={{ borderLeft: "2.5px solid var(--border-strong)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
          <Skeleton className="h-3 w-[78%] mb-2" />
          <Skeleton className="h-3 w-[55%]" />
        </div>
      ))}
    </div>
  );
}

export function TimelineSkeleton() {
  return (
    <div className="card p-4">
      <div className="relative" style={{ minHeight: 280 }}>
        {[8, 26, 46, 68, 88].map((top) => (
          <div key={top} className="absolute left-0 right-0 pl-3" style={{ top: `${top}%` }}>
            <Skeleton className="h-3 w-[70%] mb-1.5" />
            <Skeleton className="h-2.5 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function RecoveryBandSkeleton() {
  return (
    <div className="mt-7 rounded-[10px] p-5 md:p-6 border border-border" style={{ background: "var(--surface-2)" }}>
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        <div className="md:w-56 shrink-0">
          <Skeleton strong className="h-4 w-36 mb-2" />
          <Skeleton strong className="h-3 w-full mb-1.5" />
          <Skeleton strong className="h-3 w-3/4" />
        </div>
        <div className="flex-1 flex flex-wrap gap-x-8 gap-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton strong className="h-5 w-12 mb-2" />
              <Skeleton strong className="h-3 w-16" />
            </div>
          ))}
        </div>
        <Skeleton strong className="h-[72px] w-full md:w-60 shrink-0 rounded-[8px]" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-6 px-4 py-3 border-b border-border">
        {[80, 64, 72, 56, 40].map((w, i) => (
          <Skeleton key={i} className="h-2.5" style={{ width: w }} />
        ))}
      </div>
      <div className="divided">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-28 hidden sm:block" />
            <Skeleton className="h-3 w-16 hidden md:block" />
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-3 w-10 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CustomersSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden divided">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-32 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex flex-col items-end">
            <Skeleton className="h-3 w-12 mb-2" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WeekGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2 md:gap-3">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i}>
          <div className="pb-2 border-b-2 border-border flex md:flex-col items-center gap-2 md:gap-1">
            <Skeleton className="h-2.5 w-8" />
            <Skeleton className="h-3.5 w-5" />
          </div>
          <div className="card mt-2 md:mt-3 p-2 min-h-[64px] md:min-h-[140px]">
            <Skeleton className="h-3 w-full mb-2" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      <div className="card p-5">
        <Skeleton className="h-3.5 w-40 mb-5" />
        <div className="flex items-end gap-1.5 h-28">
          {[40, 26, 18, 12, 10, 16, 28, 56, 78, 92, 72, 60, 66, 82, 100, 90, 58, 42, 30, 22].map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-b-none rounded-t-[3px]" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="card p-5">
        <Skeleton className="h-3.5 w-40 mb-5" />
        <div className="flex flex-col gap-3.5 mt-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="flex justify-between mb-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SettingsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card max-w-xl divided">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 p-4">
          <div className="flex-1">
            <Skeleton className="h-3.5 w-40 mb-2" />
            <Skeleton className="h-3 w-[85%]" />
          </div>
          <Skeleton className="h-6 w-[42px] rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** The four 30-day series cards (revenue/bookings/rate/cost). */
export function AnalyticsSeriesSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card p-5">
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-5 w-14" />
          </div>
          <Skeleton className="h-12 w-full rounded-[6px]" />
        </div>
      ))}
    </div>
  );
}

/** The two ranked-list cards (top services / technician load). */
export function AnalyticsListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="card p-5">
          <Skeleton className="h-3.5 w-28 mb-5" />
          <div className="flex flex-col gap-3.5">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j}>
                <div className="flex justify-between mb-1.5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-6" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
