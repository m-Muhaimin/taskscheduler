"use client";

import { EscalationsList } from "@/components/dashboard/escalations-list";
import { CustomersSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getEscalations, useDashboardData } from "@/lib/dashboard-api";

export default function EscalationsPage() {
  const { state, retry } = useDashboardData(() => getEscalations());
  return (
    <div>
      <PageHeader title="Escalations" description="Issues the AI couldn't resolve on its own — triage and fix them here." />
      {state.status === "loading" && <CustomersSkeleton rows={6} />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="escalations" />}
      {state.status === "empty" && (
        <EmptyState title="No escalations" description="When the AI can't resolve something — an unbookable request, a calendar failure, a staff text — it lands here for you." />
      )}
      {state.status === "ready" &&
        (state.data.escalations.length === 0 ? (
          <EmptyState title="No escalations" description="When the AI can't resolve something — an unbookable request, a calendar failure, a staff text — it lands here for you." />
        ) : (
          <EscalationsList escalations={state.data.escalations} />
        ))}
    </div>
  );
}