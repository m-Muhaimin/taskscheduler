import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import {
  keyMetrics,
  inboxItems,
  todayAppointments,
  revenueRecovery,
} from "@/lib/fixtures";

export default function OverviewPage() {
  return (
    <DashboardOverview
      metrics={keyMetrics}
      inboxItems={inboxItems}
      appointments={todayAppointments}
      recovery={revenueRecovery}
    />
  );
}