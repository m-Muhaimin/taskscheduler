"use client";

import type { Appointment, InboxItem } from "@/lib/types";
import { MetricGrid, type MetricGridItem } from "./metric-grid";
import { AiInboxList } from "./ai-inbox-list";
import { TodayTimeline } from "./today-timeline";
import { RevenueRecoveryBand } from "./revenue-recovery-band";
import { Skeleton } from "@/components/ui/skeleton";
import { useDemoLoad } from "@/hooks/use-demo-load";

export interface RecoveryData {
  missedCalls: number;
  recovered: number;
  booked: number;
  estimatedRevenue: number;
  sparkline: number[]; // oldest -> newest
}

interface DashboardOverviewProps {
  metrics: MetricGridItem[];
  inboxItems: InboxItem[];
  appointments: Appointment[];
  recovery: RecoveryData;
}

/** First-paint skeleton mirroring the real overview layout (greeting, metric grid, two columns). */
function OverviewSkeleton() {
  return (
    <div>
      <div className="mb-6 space-y-3">
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-7">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border border-border rounded-[10px] bg-surface p-4">
            <Skeleton className="h-[148px] w-full" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-head font-semibold text-[15px]">AI Inbox</h2>
            <a
              href="/dashboard/inbox"
              className="text-[12.5px] text-ink-muted hover:text-ink transition-colors"
            >
              View all →
            </a>
          </div>
          <div className="border border-border rounded-[10px] bg-surface overflow-hidden [&>*+*]:border-t [&>*+*]:border-border">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-head font-semibold text-[15px]">Today&apos;s schedule</h2>
            <a
              href="/dashboard/schedule"
              className="text-[12.5px] text-ink-muted hover:text-ink transition-colors"
            >
              Full week →
            </a>
          </div>
          <div className="border border-border rounded-[10px] bg-surface p-4">
            <div className="flex flex-col gap-3" style={{ minHeight: 260 }}>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardOverview({ metrics, inboxItems, appointments, recovery }: DashboardOverviewProps) {
  const loaded = useDemoLoad();

  if (!loaded) return <OverviewSkeleton />;

  return (
    <div>
      <div className="mb-6">
        <p className="font-head font-semibold text-[26px] leading-tight">
          Good morning, Marcus.
        </p>
        <p className="text-ink-muted text-sm mt-1">
          Tuesday, September 22 — here&apos;s where things stand.
        </p>
      </div>

      <MetricGrid items={metrics} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-head font-semibold text-[15px]">AI Inbox</h2>
            <a href="/dashboard/inbox" className="text-[12.5px] text-ink-muted hover:text-ink transition-colors">
              View all →
            </a>
          </div>
          <AiInboxList items={inboxItems} compact />
        </div>

        <div className="lg:col-span-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-head font-semibold text-[15px]">Today&apos;s schedule</h2>
            <a href="/dashboard/schedule" className="text-[12.5px] text-ink-muted hover:text-ink transition-colors">
              Full week →
            </a>
          </div>
          <TodayTimeline appointments={appointments} />
        </div>
      </div>

      <RevenueRecoveryBand
        missedCalls={recovery.missedCalls}
        recovered={recovery.recovered}
        booked={recovery.booked}
        estimatedRevenue={recovery.estimatedRevenue}
        sparkline={recovery.sparkline}
      />
    </div>
  );
}