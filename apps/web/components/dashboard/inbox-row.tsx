"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe, MessageSquare, Phone } from "lucide-react";
import type { InboxItem } from "@/lib/types";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { NO_ORGANIZATION, SESSION_EXPIRED, approveInboxItem, replyToInboxItem } from "@/lib/dashboard-api";

const BAR_COLOR: Record<InboxItem["state"], string> = {
  attention: "var(--danger)",
  active: "var(--accent)",
  handled: "var(--success)",
};

const CHANNEL_ICON = { SMS: MessageSquare, Voice: Phone, Web: Globe, WhatsApp: MessageSquare } as const;

export function StateChip({ state }: { state: InboxItem["state"] }) {
  if (state === "attention") return <Chip tone="danger">Needs attention</Chip>;
  if (state === "active") return <Chip tone="muted" live>AI active</Chip>;
  return <Chip tone="success">Handled</Chip>;
}

interface InboxRowProps {
  item: InboxItem;
  compact?: boolean;
  index?: number;
  onResolve?: (id: string) => void;
}

export function InboxRow({ item, compact, index = 0, onResolve }: InboxRowProps) {
  // idle -> submitting (API in flight) -> approving (button shows a tick) ->
  // leaving (row collapses) -> removed by the parent
  const [phase, setPhase] = useState<"idle" | "approving" | "leaving">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<number[]>([]);
  const toast = useToast();
  const ChannelIcon = CHANNEL_ICON[item.channel];

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  /** Flips the row to the ✓ Approved phase, then collapses and leaves the list.
   *  The conversation closes server-side; the item would read 'handled' on the
   *  next fetch (T10) — we don't refetch, the local phase IS the handled flip. */
  function complete(message: string) {
    setEditing(false);
    setPhase("approving");
    toast.push(message, { tone: "success" });
    timers.current.push(window.setTimeout(() => setPhase("leaving"), 480));
    timers.current.push(window.setTimeout(() => onResolve?.(item.id), 480 + 300));
  }

  function fail(message: string) {
    toast.push(message, { tone: "danger" });
  }

  /** Sentinels from the data layer: the redirect/onboarding state is handled
   *  elsewhere — the row just stops and stays editable with no toast. */
  function swallowed(result: unknown): boolean {
    return result === SESSION_EXPIRED || result === NO_ORGANIZATION;
  }

  async function sendReply() {
    if (busy) return;
    const body = (textareaRef.current?.value ?? "").trim();
    if (!body) {
      fail("Enter a reply before sending.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await replyToInboxItem(item.id, body);
      if (swallowed(result)) return;
      complete(`Reply sent to ${item.name}`);
    } catch (err) {
      fail(err instanceof Error && err.message ? err.message : "Couldn't send the reply. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function approve() {
    if (busy) return;
    setSubmitting(true);
    try {
      const result = await approveInboxItem(item.id);
      if (swallowed(result)) return;
      complete(`Approved: ${item.name}`);
    } catch (err) {
      fail(err instanceof Error && err.message ? err.message : "Couldn't approve. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = phase !== "idle" || submitting;

  return (
    <div className="expandable" data-collapsed={phase === "leaving"} data-fade="true">
      <div className="expandable-inner">
        <div
          className="inbox-row metric-card-rise flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 px-4 py-3"
          data-editing={editing}
          style={{ borderLeft: `2.5px solid ${BAR_COLOR[item.state]}`, animationDelay: `${index * 55}ms` }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <p className="text-[13.5px] font-medium truncate">{item.name}</p>
              <StateChip state={item.state} />
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint font-mono shrink-0">
                <ChannelIcon size={11} aria-hidden="true" />
                {item.channel}
                {!compact && <> · {item.time}</>}
              </span>
            </div>
            <p className="text-[12.5px] text-ink-muted sm:truncate">{item.lastMessage}</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--accent-deep)" }}>
              {item.suggestion}
            </p>

            {item.state !== "handled" && (
              <div className="expandable" data-collapsed={!editing}>
                <div className="expandable-inner">
                  {/* padding keeps the focus ring from being clipped by the collapsing container */}
                  <div className="pt-2 px-0.5 pb-0.5">
                    <label htmlFor={`reply-${item.id}`} className="sr-only">
                      Reply to {item.name}
                    </label>
                    <textarea
                      id={`reply-${item.id}`}
                      ref={textareaRef}
                      className="field py-2 text-[13px] leading-[1.5] resize-none"
                      style={{ minHeight: 64 }}
                      rows={2}
                      placeholder="Edit the AI's suggested reply before sending..."
                      defaultValue={item.suggestion}
                      disabled={busy}
                      aria-busy={submitting || undefined}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditing(false);
                        }
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void sendReply();
                        }
                      }}
                    />
                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => void sendReply()}
                      >
                        {submitting ? "Sending…" : "Send reply"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {item.state !== "handled" && (
            <div className="row-actions flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                aria-expanded={editing}
                aria-controls={`reply-${item.id}`}
                disabled={busy}
                onClick={() => setEditing((v) => !v)}
                className="btn btn-ghost btn-sm"
              >
                {editing ? "Close" : "Edit"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void approve()}
                className="btn btn-primary btn-sm min-w-[84px]"
              >
                {submitting ? (
                  "Approving…"
                ) : phase === "idle" ? (
                  "Approve"
                ) : (
                  <>
                    <Check size={14} aria-hidden="true" />
                    Approved
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
