"use client";

import { MessagesList } from "@/components/dashboard/messages-list";
import { TableSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getMessages, useDashboardData } from "@/lib/dashboard-api";

export default function MessagesPage() {
  const { state, retry } = useDashboardData(() => getMessages());

  return (
    <div>
      <PageHeader title="Messages" description="Every SMS and WhatsApp message the AI sends, with live delivery status." />
      {state.status === "loading" && <TableSkeleton rows={6} />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="messages" />}
      {state.status === "empty" && (
        <EmptyState
          title="No messages yet"
          description="Outbound messages — confirmations, offers, and fallback retries — appear here as they're sent."
        />
      )}
      {state.status === "ready" &&
        (state.data.messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            description="Outbound messages — confirmations, offers, and fallback retries — appear here as they're sent."
          />
        ) : (
          <MessagesList messages={state.data.messages} />
        ))}
    </div>
  );
}