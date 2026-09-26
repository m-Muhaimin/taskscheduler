"use client";

import { useMemo, useState } from "react";
import type { MessageRow } from "@/lib/types";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips";

const STATUS_TONE: Record<MessageRow["status"], ChipTone> = {
  queued: "muted",
  sent: "muted",
  delivered: "success",
  failed: "danger",
  retried: "success",
  escalated: "danger",
  blocked_optin: "muted",
};

const STATUS_ORDER: MessageRow["status"][] = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "retried",
  "escalated",
  "blocked_optin",
];

const CHANNEL_LABEL: Record<MessageRow["channel"], string> = { sms: "SMS" };

type StatusFilter = "all" | MessageRow["status"];

/**
 * Outbound delivery ledger rows (page-1 data, newest-first as the API sorts them).
 * Read-only per plan Decision 6: no reply/compose actions, no pagination controls.
 */
export function MessagesList({ messages }: { messages: MessageRow[] }) {
  const [status, setStatus] = useState<StatusFilter>("all");

  const options: ChipOption<StatusFilter>[] = useMemo(
    () => [
      { value: "all", label: "All", count: messages.length },
      ...STATUS_ORDER.map((s) => ({ value: s, label: s, count: messages.filter((m) => m.status === s).length })),
    ],
    [messages]
  );

  const filtered = useMemo(
    () => (status === "all" ? messages : messages.filter((m) => m.status === status)),
    [messages, status]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-4">
        <p className="text-[12.5px] text-ink-muted" aria-live="polite">
          {filtered.length} of {messages.length} messages
        </p>
        <FilterChips options={options} value={status} onChange={setStatus} label="Filter messages by status" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-[13px]">
            <thead>
              <tr className="text-left text-ink-faint text-[11px] uppercase tracking-wide border-b border-border">
                <th scope="col" className="font-medium px-4 py-2.5">To</th>
                <th scope="col" className="font-medium px-4 py-2.5">Body</th>
                <th scope="col" className="font-medium px-4 py-2.5">Channel</th>
                <th scope="col" className="font-medium px-4 py-2.5">Kind</th>
                <th scope="col" className="font-medium px-4 py-2.5">Status</th>
                <th scope="col" className="font-medium px-4 py-2.5">Error</th>
                <th scope="col" className="font-medium px-4 py-2.5 text-right">Sent</th>
                <th scope="col" className="font-medium px-4 py-2.5">Recipient</th>
              </tr>
            </thead>
            <tbody className="divided">
              {filtered.map((m, i) => (
                <tr
                  key={m.id}
                  className="hover:bg-surface-2 transition-colors metric-card-rise"
                  style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                >
                  <td className="px-4 py-2.5 font-mono text-[12px]">{m.toPhone}</td>
                  <td className="px-4 py-2.5 text-ink-muted truncate max-w-[280px]" title={m.body}>
                    {m.body}
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip tone="muted">{CHANNEL_LABEL[m.channel]}</Chip>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{m.kindLabel ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Chip tone={STATUS_TONE[m.status]} live={m.status === "queued"}>
                      {m.statusLabel}
                    </Chip>
                  </td>
                  <td className="px-4 py-2.5">
                    {m.errorCode ? (
                      <span className="font-mono text-[11.5px] text-ink-muted">{m.errorCode}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-faint text-[11.5px]">{m.createdAtDisplay}</td>
                  <td className="px-4 py-2.5 text-ink-faint text-[11.5px]">
                    {m.customerName ?? m.toPhone}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="text-center text-[13px] text-ink-muted py-8">No messages with this status.</p>
        )}
      </div>
    </div>
  );
}