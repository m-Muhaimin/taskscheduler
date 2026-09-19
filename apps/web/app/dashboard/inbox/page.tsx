"use client";

import { AiInboxList } from "@/components/dashboard/ai-inbox-list";
import { InboxListSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getInboxItems, useDashboardData } from "@/lib/dashboard-api";

export default function InboxPage() {
  const { state, retry } = useDashboardData(() => getInboxItems());

  return (
    <div>
      <PageHeader
        title="AI Inbox"
        description="Conversations the AI is running, handled, or needs you to look at."
      />
      {state.status === "loading" && <InboxListSkeleton rows={6} />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="the inbox" />}
      {state.status === "empty" && (
        <EmptyState
          title="No conversations yet"
          description="When the AI starts answering calls and texts, the inbox fills up here — nothing gets missed."
        />
      )}
      {state.status === "ready" && <AiInboxList items={state.data.items} showFilters />}
    </div>
  );
}