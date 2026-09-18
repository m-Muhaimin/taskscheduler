"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { maskPhone, relativeTime } from "@/lib/format";
import type { Escalation } from "@tradescheduler/shared";

const TYPE_LABEL: Record<Escalation["type"], string> = {
  ambiguous_intent: "Ambiguous intent",
  no_availability: "No availability",
  calendar_api_failure: "Calendar API failure",
  sms_delivery_failure: "SMS delivery failure",
  processing_error: "Processing error",
};

const TYPE_VARIANT: Record<Escalation["type"], "destructive" | "secondary" | "outline"> = {
  ambiguous_intent: "destructive",
  no_availability: "destructive",
  calendar_api_failure: "destructive",
  sms_delivery_failure: "destructive",
  processing_error: "outline",
};

export function EscalationCard({ escalation, onResolve }: { escalation: Escalation; onResolve: () => void }) {
  const isPending = escalation.status === "pending";

  return (
    <Card className="p-0">
      <CardContent className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant={TYPE_VARIANT[escalation.type]}>
                {TYPE_LABEL[escalation.type]}
              </Badge>
              {isPending ? (
                <Badge variant="urgent">
                  Pending
                </Badge>
              ) : (
                <Badge variant="secondary">
                  Resolved
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground line-clamp-2">{escalation.content ?? "—"}</p>

            <div className="flex items-center gap-3 text-2xs text-muted-foreground tabular-nums">
              <span className="truncate">{maskPhone(escalation.customerPhone)}</span>
              <span className="shrink-0">{relativeTime(escalation.createdAt)}</span>
            </div>
          </div>

          {isPending && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-10 lg:h-8"
              onClick={onResolve}
            >
              Resolve
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
