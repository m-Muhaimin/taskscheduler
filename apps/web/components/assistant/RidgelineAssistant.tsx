"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { authedFetch } from "../../lib/auth";
import type { AssistantChatResponse, AssistantMessage } from "@tradescheduler/shared";

const WELCOME: AssistantMessage = {
  role: "assistant",
  content:
    "Hi, I'm RidgeLine Assistant. Ask me about today's schedule, moving an appointment, or anything customer-facing.",
};

/** Shown in-thread as an assistant-styled bubble when the API can't be reached. */
const NETWORK_ERROR = "Something went wrong — please try again.";
/** Shown in-thread when the API rejects the session (defensive; the route is public). */
const AUTH_ERROR = "Sign in to use RidgeLine Assistant.";
/** Extra bubble appended to the thread after an escalated turn. */
const ESCALATED_NOTE = "I've flagged this for follow-up.";

/** Typing effect pacing — ~2 chars every 16ms reads as natural typing. */
const TYPING_TICK_MS = 16;
const TYPING_CHARS_PER_TICK = 2;

export function RidgeLineAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Reply being revealed by the typing effect; null when idle or done. */
  const [pending, setPending] = useState<{ full: string; shown: number; escalated: boolean } | null>(null);

  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasOpenRef = useRef(false);

  // Focus management: composer on open, launcher on close. Doesn't run on mount
  // (wasOpenRef starts false) so the page never loses its initial focus.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      launcherRef.current?.focus();
    }
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, error, open, pending]);

  // Typing effect: reveal pending.full progressively; when complete, commit
  // the bubble (plus the escalated note) to the thread and unlock the composer.
  useEffect(() => {
    if (!pending) return;
    if (pending.shown >= pending.full.length) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: pending.full },
        ...(pending.escalated ? [{ role: "assistant" as const, content: ESCALATED_NOTE }] : []),
      ]);
      setPending(null);
      setBusy(false);
      return;
    }
    const id = window.setInterval(() => {
      setPending((p) =>
        p ? { ...p, shown: Math.min(p.full.length, p.shown + TYPING_CHARS_PER_TICK) } : p,
      );
    }, TYPING_TICK_MS);
    return () => window.clearInterval(id);
  }, [pending]);

  async function submit() {
    const content = input.trim();
    if (!content || busy) return;
    const userMsg: AssistantMessage = { role: "user", content };
    const history = [...messages, userMsg];

    setMessages(history);
    setInput("");
    setError(null);
    setBusy(true);

    try {
      const res = await authedFetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, tradespersonName: undefined }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? AUTH_ERROR : NETWORK_ERROR);
        setBusy(false);
        return;
      }
      const data = (await res.json()) as AssistantChatResponse;
      // Reveal the reply with the typing effect; busy stays true until the
      // reveal commits (busy && !pending shows the "typing…" hint).
      setPending({ full: data.reply, shown: 0, escalated: data.escalated });
    } catch {
      // network failure / non-JSON body — keep the widget usable, message stays in the thread
      setError(NETWORK_ERROR);
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="btn btn-primary fixed bottom-5 right-5 z-50 rounded-xl shadow-card px-4"
        aria-label={open ? "Close RidgeLine Assistant" : "Open RidgeLine Assistant"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
        <span>{open ? "Close" : "Ask RidgeLine"}</span>
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="RidgeLine Assistant"
          className="fade-in fixed bottom-20 right-5 z-50 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface text-ink shadow-card"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="flex min-w-0 items-center gap-2">
              <Sparkles size={16} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate font-head text-[15px] font-semibold">RidgeLine Assistant</span>
            </span>
            <button
              type="button"
              className="icon-btn shrink-0"
              aria-label="Close RidgeLine Assistant"
              onClick={() => setOpen(false)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[80%] whitespace-pre-wrap rounded-xl bg-accent px-3 py-2 text-[13px] leading-snug text-accent-ink"
                    : "max-w-[80%] whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-snug text-ink"
                }
              >
                {m.content}
              </div>
            ))}
            {pending && (
              <div
                aria-hidden="true"
                className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-snug text-ink"
              >
                {pending.full.slice(0, pending.shown)}
                <span className="ml-0.5 inline-block h-[0.9em] w-[2px] animate-pulse bg-ink-muted align-middle" />
              </div>
            )}
            {error && (
              <div className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-snug text-danger">
                {error}
              </div>
            )}
          </div>

          {busy && !pending && (
            <p className="shrink-0 px-4 py-1.5 text-[11.5px] text-ink-muted" aria-live="polite">
              RidgeLine is typing…
            </p>
          )}

          <div className="flex shrink-0 items-end gap-2 border-t border-border p-3">
            <textarea
              ref={inputRef}
              className="field min-w-0 flex-1 resize-none rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-snug"
              rows={2}
              placeholder="Ask about your schedule…"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Message RidgeLine Assistant"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm shrink-0"
              onClick={() => void submit()}
              disabled={busy}
              aria-label="Send message"
            >
              <Send size={14} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}
    </>
  );
}