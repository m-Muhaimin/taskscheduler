"use client";

import { JobsTable } from "@/components/dashboard/jobs-table";
import { TableSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getJobs, useDashboardData } from "@/lib/dashboard-api";

export default function JobsPage() {
  const { state, retry } = useDashboardData(() => getJobs());

  return (
    <div>
      <PageHeader title="Jobs" description="Every booked job, from dispatch to completion." />
      {state.status === "loading" && <TableSkeleton rows={6} />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="jobs" />}
      {state.status === "empty" && (
        <EmptyState
          title="No jobs yet"
          description="Booked appointments will land here — from needs-dispatch to completed."
        />
      )}
      {state.status === "ready" &&
        (state.data.jobs.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description="Booked appointments will land here — from needs-dispatch to completed."
          />
        ) : (
          <JobsTable jobs={state.data.jobs} />
        ))}
    </div>
  );
}