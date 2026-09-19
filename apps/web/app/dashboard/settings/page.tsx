"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";
import { AiSwitch } from "@/components/dashboard/ai-switch";
import { authedFetch } from "@/lib/auth";
import { useSession } from "@/lib/session";
import type { GoogleConnectionStatus } from "@tradescheduler/shared";

interface ToggleRow {
  id: string;
  title: string;
  description: string;
  defaultOn: boolean;
}

const ROWS: ToggleRow[] = [
  {
    id: "ai-front-desk",
    title: "AI front desk",
    description: "Let the AI answer, qualify, and book new inquiries automatically.",
    defaultOn: true,
  },
  {
    id: "review-requests",
    title: "Auto-send review requests",
    description: "Text a review link when a job is marked complete.",
    defaultOn: true,
  },
  {
    id: "deposit-required",
    title: "Deposit required for new bookings",
    description: "Ask for a $50 deposit before confirming a first-time customer.",
    defaultOn: false,
  },
];

type GoogleBanner = "connected" | "skipped" | "failed" | null;

const GOOGLE_BANNER_COPY: Record<Exclude<GoogleBanner, null>, string> = {
  connected: "Calendar connected — new bookings will sync to your Google Calendar.",
  skipped: "Calendar connection skipped. Connect any time from here.",
  failed: "We couldn't connect your Google Calendar. Try again.",
};

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="max-w-xl">
      <h2 className="font-head font-semibold text-[15px] mb-3">{title}</h2>
      <div className="border border-border rounded-[10px] bg-surface [&>*+*]:border-t [&>*+*]:border-border">
        {children}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut } = useSession();
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(ROWS.map((r) => [r.id, r.defaultOn]))
  );
  const [google, setGoogle] = useState<GoogleConnectionStatus>({ connected: false, calendarId: null });
  const [googleLoading, setGoogleLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [banner, setBanner] = useState<GoogleBanner>(null);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("google") as GoogleBanner | null;
    if (param === "connected" || param === "skipped" || param === "failed") {
      setBanner(param);
      window.history.replaceState({}, "", "/dashboard/settings");
    }
    authedFetch("/api/auth/google/status")
      .then(async (res) => {
        if (res.ok) setGoogle((await res.json()) as GoogleConnectionStatus);
      })
      .catch(() => {})
      .finally(() => setGoogleLoading(false));
  }, []);

  async function connectCalendar() {
    const res = await authedFetch("/api/auth/google/start");
    if (!res.ok) {
      setBanner("failed");
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
  }

  async function disconnectCalendar() {
    setDisconnecting(true);
    try {
      const res = await authedFetch("/api/auth/google/", { method: "DELETE" });
      if (res.ok) setGoogle({ connected: false, calendarId: null });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="font-head font-semibold text-[15px]">Settings</p>

      {banner && (
        <div className="max-w-xl rounded-[10px] border border-border bg-surface px-4 py-3 text-[13px] text-ink">
          {GOOGLE_BANNER_COPY[banner]}
        </div>
      )}

      <SectionCard title="Calendar">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-9 h-9 rounded-[9px] bg-surface-2 border border-border flex items-center justify-center">
              <CalendarDays size={17} className="text-ink-muted" />
            </div>
            <div>
              <p className="text-[13.5px] font-medium">Google Calendar</p>
              <p className="text-[12px] text-ink-muted mt-0.5">
                {googleLoading
                  ? "Checking connection…"
                  : google.connected
                    ? `Connected — syncing to ${google.calendarId ?? "primary"}.`
                    : "Connect Google Calendar to auto-schedule jobs."}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            {google.connected ? (
              <button
                type="button"
                onClick={() => void disconnectCalendar()}
                disabled={disconnecting}
                className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void connectCalendar()}
                disabled={googleLoading}
                className="rounded-[10px] bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
              >
                {googleLoading ? "Loading…" : "Connect"}
              </button>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Automation">
        {ROWS.map((row) => (
          <div key={row.id} className="flex items-center justify-between p-4">
            <div>
              <p className="text-[13.5px] font-medium">{row.title}</p>
              <p className="text-[12px] text-ink-muted mt-0.5">{row.description}</p>
            </div>
            <AiSwitch
              on={state[row.id]}
              onChange={(next) => setState((s) => ({ ...s, [row.id]: next }))}
              label={row.title}
            />
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Account">
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="text-[13.5px] font-medium">{user?.displayName ?? "Owner"}</p>
            <p className="text-[12px] text-ink-muted mt-0.5">{user?.email ?? "Not signed in"}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-medium text-ink hover:bg-surface-2"
          >
            Sign out
          </button>
        </div>
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="text-[13.5px] font-medium">Session</p>
            <p className="text-[12px] text-ink-muted mt-0.5">{"Signed in with a 7-day session cookie."}</p>
          </div>
          <Loader2 size={16} className="text-ink-faint" />
        </div>
      </SectionCard>
    </div>
  );
}
