"use client";

import { useState } from "react";
import type { InboxItem } from "@/lib/types";

const BAR_COLOR: Record<InboxItem["state"], string> = {
  attention: "var(--danger)",
  active: "var(--accent)",
  handled: "var(--success)",
};

function StateChip({ state }: { state: InboxItem["state"] }) {
  if (state === "attention") {
    return (
      <span
        className="text-[10.5px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
      >
        Needs attention
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="text-[10.5px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-surface-2 text-ink-muted">
        AI active
      </span>
    );
  }
  return (
    <span
      className="text-[10.5px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: "var(--success-bg)", color: "var(--success)" }}
    >
      Handled
    </span>
  );
}

interface InboxRowProps {
  item: InboxItem;
  compact?: boolean;
  index?: number;
  onResolve?: (id: number) => void;
}

export function InboxRow({ item, compact, index = 0, onResolve }: InboxRowProps) {
  const [resolving, setResolving] = useState(false);
  const [editing, setEditing] = useState(false);

  function handleApprove() {
    setResolving(true);
    window.setTimeout(() => onResolve?.(item.id), 420);
  }

  return (
    <div
      className={`inbox-row animate-rise flex items-start gap-3 px-4 py-3 ${resolving ? "is-resolved" : ""}`}
      style={{ borderLeft: `2.5px solid ${BAR_COLOR[item.state]}`, animationDelay: `${index * 60}ms` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className="text-[13.5px] font-medium truncate">{item.name}</p>
          {item.state === "active" && <span className="pulse-dot" aria-hidden />}
          <StateChip state={item.state} />
          {!compact && (
            <span className="text-[11px] text-ink-faint font-mono ml-auto shrink-0">{item.time}</span>
          )}
        </div>
        <p className="text-[12.5px] text-ink-muted truncate">{item.lastMessage}</p>
        <p className="text-[12px] mt-1" style={{ color: "var(--accent)" }}>
          {item.suggestion}
        </p>
        {editing && (
          <textarea
            className="mt-2 w-full text-[12.5px] border border-border-strong rounded-[8px] p-2 bg-transparent outline-none"
            rows={2}
            placeholder="Edit the AI's suggested reply before sending..."
            defaultValue={item.suggestion}
          />
        )}
      </div>

      {item.state !== "handled" ? (
        <div className="row-actions flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-[13px] font-medium px-3 py-1.5 rounded-[8px] border border-border-strong hover:bg-surface-2 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={handleApprove}
            className="text-[13px] font-medium px-3 py-1.5 rounded-[8px] bg-accent text-accent-ink hover:brightness-105 transition-[filter]"
          >
            Approve
          </button>
        </div>
      ) : (
        <span className="text-[11px] text-ink-faint font-mono">{item.time}</span>
      )}
    </div>
  );
}
