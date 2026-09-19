"use client";

import { useState } from "react";
import { AiInboxList } from "@/components/dashboard/ai-inbox-list";
import { inboxItems } from "@/lib/fixtures";

export default function InboxPage() {
  const [, setAttentionCount] = useState(
    inboxItems.filter((i) => i.state === "attention").length
  );

  return (
    <div>
      <div className="mb-4">
        <p className="font-head font-semibold text-[15px]">AI Inbox</p>
        <p className="text-[12.5px] text-ink-muted mt-0.5">
          Conversations the AI is running, handled, or needs you to look at.
        </p>
      </div>
      <AiInboxList items={inboxItems} showFilters onCountChange={setAttentionCount} />
    </div>
  );
}
