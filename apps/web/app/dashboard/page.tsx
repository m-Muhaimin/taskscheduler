"use client";

import { MetricGrid } from "@/components/dashboard/metric-grid";
import { AiInboxList } from "@/components/dashboard/ai-inbox-list";
import { TodayTimeline } from "@/components/dashboard/today-timeline";
import { RevenueRecoveryBand } from "@/components/dashboard/revenue-recovery-band";
import {
  MetricGridSkeleton,
  InboxListSkeleton,
  TimelineSkeleton,
  RecoveryBandSkeleton,
} from "@/components/dashboard/skeletons";
import { SectionHeader } from "@/components/ui/page-header";
import { Greeting } from "@/components/dashboard/greeting";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getSummary, useDashboardData } from "@/lib/dashboard-api";

function OverviewSkeleton() {
  return (
    <>
      <MetricGridSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 min-w-0">
          <SectionHeader title="AI Inbox" href="/dashboard/inbox" linkLabel="View all" />
          <InboxListSkeleton rows={4} />
        </section>
        <section className="lg:col-span-5 min-w-0">
          <SectionHeader title="Today's schedule" href="/dashboard/schedule" linkLabel="Full week" />
          <TimelineSkeleton />
        </section>
      </div>
      <RecoveryBandSkeleton />
    </>
  );
}

export default function OverviewPage() {
  const { state, retry } = useDashboardData(() => getSummary());

  return (
    <div>
      <Greeting />

      {state.status === "loading" && <OverviewSkeleton />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="the overview" />}
      {state.status === "empty" && (
        <EmptyState
          title="No data yet — the AI starts booking here"
          description="The dashboard fills in once your org is connected: metrics, conversations, schedule and revenue recovery will all show up here."
        />
      )}

      {state.status === "ready" && (
        <>
          {/* API metrics are already MetricGridItem-compatible (id/label/value/prefix/suffix/tone/trend/chartData/href) */}
          <MetricGrid items={state.data.metrics} />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 min-w-0">
              <SectionHeader title="AI Inbox" href="/dashboard/inbox" linkLabel="View all" />
              <AiInboxList items={state.data.inbox} compact />
            </section>

            <section className="lg:col-span-5 min-w-0">
              <SectionHeader title="Today's schedule" href="/dashboard/schedule" linkLabel="Full week" />
              <TodayTimeline appointments={state.data.today} />
            </section>
          </div>

          <RevenueRecoveryBand
            missedCalls={state.data.revenueRecovery.missedCalls}
            recovered={state.data.revenueRecovery.recovered}
            booked={state.data.revenueRecovery.booked}
            estimatedRevenue={state.data.revenueRecovery.estimatedRevenue}
            sparkline={state.data.revenueRecovery.sparkline}
          />
        </>
      )}
    </div>
  );
}