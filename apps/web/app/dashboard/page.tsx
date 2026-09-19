import { MetricGrid } from "@/components/dashboard/metric-grid";
import { AiInboxList } from "@/components/dashboard/ai-inbox-list";
import { TodayTimeline } from "@/components/dashboard/today-timeline";
import { RevenueRecoveryBand } from "@/components/dashboard/revenue-recovery-band";
import {
  keyMetrics,
  inboxItems,
  todayAppointments,
  revenueRecovery,
} from "@/lib/fixtures";

export default function OverviewPage() {
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

      <MetricGrid items={keyMetrics} />

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
          <TodayTimeline appointments={todayAppointments} />
        </div>
      </div>

      <RevenueRecoveryBand
        missedCalls={revenueRecovery.missedCalls}
        recovered={revenueRecovery.recovered}
        booked={revenueRecovery.booked}
        estimatedRevenue={revenueRecovery.estimatedRevenue}
        sparkline={revenueRecovery.sparkline}
      />
    </div>
  );
}
