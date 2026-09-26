"use client";

import { MessagesList } from "@/components/dashboard/messages-list";
import { TableSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getMessages, useDashboardData } from "@/lib/dashboard-api";
import { useMemo } from "react";

export default function MessagesPage() {
  const { state, retry } = useDashboardData(() => getMessages());
  const messages = state.status === "ready" ? state.data.messages : [];

  const totalMessages = messages.length;
  const failedOrEscalated = useMemo(
    () => messages.filter((m) => m.status === "failed" || m.status === "escalated").length,
    [messages],
  );

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Every SMS the AI sends, with live delivery status."
        actions={
          failedOrEscalated > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1 text-[11px] font-medium text-danger">
              <span className="inline-flex h-2 w-2 rounded-full bg-danger" />
              {failedOrEscalated} failed or escalated
            </span>
          ) : totalMessages > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-ink-muted">
              {totalMessages} messages
            </span>
          ) : null
        }
      />
      {state.status === "loading" && <TableSkeleton rows={6} />}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={retry} label="messages" />
      )}
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
          <MessagesList messages={messages} />
        ))}
    </div>
  );
}