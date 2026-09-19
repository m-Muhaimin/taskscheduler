import { DemandByHourChart, ConversationOutcomesChart } from "@/components/dashboard/analytics-charts";
import { inboundDemandByHour, conversationOutcomes } from "@/lib/fixtures";

export default function AnalyticsPage() {
  return (
    <div>
      <p className="font-head font-semibold text-[15px] mb-1">Analytics</p>
      <p className="text-[12.5px] text-ink-muted mb-5">
        Where demand comes from and where it drops off.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DemandByHourChart data={inboundDemandByHour} />
        <ConversationOutcomesChart outcomes={conversationOutcomes} />
      </div>
    </div>
  );
}
