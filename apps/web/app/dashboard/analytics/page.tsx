"use client";

import { DemandByHourChart, ConversationOutcomesChart } from "@/components/dashboard/analytics-charts";
import { AnalyticsSeriesCard } from "@/components/dashboard/analytics-series-card";
import { AnalyticsListCard } from "@/components/dashboard/analytics-list-card";
import {
  ChartsSkeleton,
  AnalyticsSeriesSkeleton,
  AnalyticsListSkeleton,
} from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getAnalytics, useDashboardData } from "@/lib/dashboard-api";

const values = (series: { date: string; value: number }[]) => series.map((p) => p.value);

export default function AnalyticsPage() {
  const { state, retry } = useDashboardData(() => getAnalytics());

  return (
    <div>
      <PageHeader title="Analytics" description="Where demand comes from and where it drops off." />
      {state.status === "loading" && (
        <div className="flex flex-col gap-6">
          <ChartsSkeleton />
          <AnalyticsSeriesSkeleton />
          <AnalyticsListSkeleton />
        </div>
      )}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="analytics" />}
      {state.status === "empty" && (
        <EmptyState
          title="No analytics yet"
          description="Once the AI handles some conversations, demand, outcomes, revenue and cost trends all show up here."
        />
      )}

      {state.status === "ready" && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <DemandByHourChart data={state.data.demandByHour} />
            <ConversationOutcomesChart outcomes={state.data.outcomes} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <AnalyticsSeriesCard
              title="Revenue (30d)"
              values={values(state.data.revenueByDay)}
              prefix="$"
              delayMs={60}
              ariaLabel="Revenue per day over the last 30 days"
            />
            <AnalyticsSeriesCard
              title="Bookings (30d)"
              values={values(state.data.bookingsByDay)}
              bar
              delayMs={140}
              ariaLabel="Bookings per day over the last 30 days"
            />
            <AnalyticsSeriesCard
              title="AI booking rate (30d)"
              values={values(state.data.aiBookingRateByDay)}
              aggregate="mean"
              suffix="%"
              tone="success"
              delayMs={220}
              ariaLabel="AI booking rate per day over the last 30 days"
            />
            <AnalyticsSeriesCard
              title="AI cost (30d)"
              values={values(state.data.aiCostByDay)}
              prefix="$"
              delayMs={300}
              ariaLabel="AI cost per day over the last 30 days"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <AnalyticsListCard
              title="Top services"
              rows={state.data.topServices.map((s) => ({ label: s.service, count: s.count }))}
              delayMs={380}
              emptyHint="No services booked yet"
            />
            <AnalyticsListCard
              title="Technician load"
              rows={state.data.technicianLoad.map((t) => ({ label: t.name, count: t.count }))}
              tone="success"
              delayMs={460}
              emptyHint="No technicians assigned yet"
            />
          </div>
        </div>
      )}
    </div>
  );
}