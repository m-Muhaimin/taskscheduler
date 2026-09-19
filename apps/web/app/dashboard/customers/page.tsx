"use client";

import { CustomersList } from "@/components/dashboard/customers-list";
import { CustomersSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getCustomers, useDashboardData } from "@/lib/dashboard-api";

export default function CustomersPage() {
  const { state, retry } = useDashboardData(() => getCustomers());

  return (
    <div>
      <PageHeader title="Customers" description="Everyone the AI has talked to for this business." />
      {state.status === "loading" && <CustomersSkeleton rows={6} />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="customers" />}
      {state.status === "empty" && (
        <EmptyState
          title="No customers yet"
          description="Every person the AI talks to becomes a customer record here — searchable, with their job history."
        />
      )}
      {state.status === "ready" &&
        (state.data.customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Every person the AI talks to becomes a customer record here — searchable, with their job history."
          />
        ) : (
          <CustomersList customers={state.data.customers} />
        ))}
    </div>
  );
}