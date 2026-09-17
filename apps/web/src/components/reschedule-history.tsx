"use client";

import { Badge } from "@/components/ui/badge";
import { RescheduleLogList } from "@/components/reschedule-log-list";
import type { DashboardBooking } from "@/lib/fixtures";

const RESCHEDULE_ACTION_LABEL: Record<string, string> = {
  "reschedule-offer": "Reschedule offered",
  "reschedule-confirm": "Confirmed by customer",
  "reschedule-completed": "Rescheduled",
  "reschedule-failed": "Reschedule failed",
};

export function RescheduleHistory({ booking }: { booking: DashboardBooking }) {
  const hasLog = booking.rescheduleLog.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Reschedule history</h3>
        {hasLog && (
          <Badge variant="outline" className="text-xs">
            {booking.rescheduleLog.length} event{booking.rescheduleLog.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      {!hasLog ? (
        <p className="text-sm text-muted-foreground">No reschedules yet.</p>
      ) : (
        <RescheduleLogList
          entries={booking.rescheduleLog}
          actionLabel={RESCHEDULE_ACTION_LABEL}
        />
      )}
    </div>
  );
}
