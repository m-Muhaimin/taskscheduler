"use client";

import { useEffect, useId, useState } from "react";
import { CalendarDays, LogOut } from "lucide-react";
import { ToggleList, type ToggleRow } from "@/components/ui/toggle-list";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { authedFetch } from "@/lib/auth";
import { validateEmail, validatePassword } from "@/lib/validation";
import type { GoogleConnectionStatus } from "@tradescheduler/shared";

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

/** E.164-ish — the same shape the API validates phoneNumber with. */
const PHONE_RE = /^\+?[1-9][0-9]{1,14}$/;

/** Maps PATCH /api/auth/profile error bodies to inline field copy. */
async function profileErrorText(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  const code = body?.error;
  if (code === "email_taken") return "That email is already in use.";
  if (code === "invalid_body") return "Check the details above and try again.";
  if (res.status === 401) return "Your session has expired. Sign in again.";
  if (res.status >= 500) return "Something went wrong on our end. Try again in a few minutes.";
  return fallback;
}

// ── Column 2: profile & account rows ────────────────────────────────────────

interface FieldRowProps {
  label: string;
  initialValue: string;
  placeholder?: string;
  hint?: string;
  successMessage: string;
  saveLabel: string;
  /** Returns an inline error string, or null on success. */
  onSave: (value: string) => Promise<string | null>;
}

/** One stacked edit row: label, input + Save button, hint / inline error. */
function FieldRow({
  label,
  initialValue,
  placeholder,
  hint,
  successMessage,
  saveLabel,
  onSave,
}: FieldRowProps) {
  const toast = useToast();
  const id = useId();
  const messageId = `${id}-message`;
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const err = await onSave(value);
      if (err) setError(err);
      else toast.push(successMessage, { tone: "success" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="p-4">
      <label htmlFor={id} className="block text-[13.5px] font-medium mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          className="field min-w-0 flex-1"
          value={value}
          placeholder={placeholder}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? messageId : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !pending) void save();
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm shrink-0"
          onClick={() => void save()}
          disabled={pending}
          aria-label={saveLabel}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {hint && <p className="text-[12px] text-ink-muted mt-1.5">{hint}</p>}
      {error && (
        <p id={messageId} className="mt-1.5 text-[12.5px] leading-snug" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function NameRow({ onSaved }: { onSaved: () => Promise<void> }) {
  const { user } = useSession();
  return (
    <FieldRow
      label="Display name"
      initialValue={user?.displayName ?? ""}
      successMessage="Display name updated"
      saveLabel="Save display name"
      onSave={async (value) => {
        const displayName = value.trim();
        if (!displayName) return "Enter a display name.";
        const res = await authedFetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        });
        if (!res.ok) return profileErrorText(res, "Couldn't update your display name.");
        await onSaved();
        return null;
      }}
    />
  );
}

function EmailRow({ onSaved }: { onSaved: () => Promise<void> }) {
  const { user } = useSession();
  return (
    <FieldRow
      label="Email"
      initialValue={user?.email ?? ""}
      successMessage="Email updated"
      saveLabel="Save email address"
      onSave={async (value) => {
        const invalid = validateEmail(value);
        if (invalid) return invalid;
        const res = await authedFetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: value.trim() }),
        });
        if (!res.ok) return profileErrorText(res, "Couldn't update your email.");
        await onSaved();
        return null;
      }}
    />
  );
}

function PhoneRow({ onSaved }: { onSaved: () => Promise<void> }) {
  const { user } = useSession();
  return (
    <FieldRow
      label="Phone number"
      initialValue={user?.phoneNumber ?? ""}
      placeholder="+15551234567"
      hint="Used when the AI needs to reach you. Leave empty to remove."
      successMessage="Phone number updated"
      saveLabel="Save phone number"
      onSave={async (value) => {
        const phoneNumber = value.trim();
        if (phoneNumber && !PHONE_RE.test(phoneNumber)) {
          return "Enter a valid phone number (e.g. +15551234567).";
        }
        const res = await authedFetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: phoneNumber || null }),
        });
        if (!res.ok) return profileErrorText(res, "Couldn't update your phone number.");
        await onSaved();
        return null;
      }}
    />
  );
}

function PasswordBlock() {
  const toast = useToast();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const errorId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const invalid = validatePassword(newPassword, "signup");
    if (invalid) {
      setError(invalid);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password doesn't match the confirmation.");
      return;
    }
    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await authedFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        toast.push("Password updated", { tone: "success" });
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 401 && body?.error === "invalid_credentials") {
        setError("Current password is wrong.");
      } else if (body?.error === "invalid_body") {
        setError("Check the details above and try again.");
      } else {
        setError(
          res.status >= 500
            ? "Something went wrong on our end. Try again in a few minutes."
            : "Couldn't update your password.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  const invalid = error ? true : undefined;
  const describedBy = error ? errorId : undefined;

  return (
    <div className="p-4">
      <p className="text-[13.5px] font-medium">Change password</p>
      <p className="text-[12px] text-ink-muted mt-0.5 mb-3">Use at least 8 characters.</p>
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor={currentId} className="block text-[13.5px] font-medium mb-1.5">
            Current password
          </label>
          <input
            id={currentId}
            type="password"
            className="field"
            value={currentPassword}
            disabled={pending}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={newId} className="block text-[13.5px] font-medium mb-1.5">
            New password
          </label>
          <input
            id={newId}
            type="password"
            className="field"
            value={newPassword}
            disabled={pending}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={confirmId} className="block text-[13.5px] font-medium mb-1.5">
            Confirm new password
          </label>
          <input
            id={confirmId}
            type="password"
            className="field"
            value={confirmPassword}
            disabled={pending}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-[12.5px] leading-snug" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm mt-3"
        onClick={() => void submit()}
        disabled={pending}
        aria-label="Update password"
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </div>
  );
}

function SignOutRow() {
  const { signOut } = useSession();
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">Sign out</p>
        <p className="text-[12px] text-ink-muted mt-0.5">Ends this session on this device.</p>
      </div>
      <button type="button" onClick={() => void signOut()} className="btn btn-danger btn-sm shrink-0" aria-label="Sign out">
        <LogOut size={14} aria-hidden="true" />
        Sign out
      </button>
    </div>
  );
}

function AccountCardSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <Skeleton className="h-3.5 w-32" />
      <Skeleton className="h-9 w-full rounded-[10px]" />
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-9 w-full rounded-[10px]" />
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="h-9 w-full rounded-[10px]" />
    </div>
  );
}

// ── Panel: two-column layout ────────────────────────────────────────────────

export function SettingsPanel() {
  const toast = useToast();
  const { user, loading: sessionLoading, refresh } = useSession();

  const [google, setGoogle] = useState<GoogleConnectionStatus>({ connected: false, calendarId: null });
  const [googleLoading, setGoogleLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [banner, setBanner] = useState<GoogleBanner>(null);

  // Real OAuth status + post-redirect banner (no fixture data for OAuth).
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
      if (res.ok) {
        setGoogle({ connected: false, calendarId: null });
        toast.push("Google Calendar disconnected", { tone: "default" });
      }
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {banner && (
        <div className="max-w-xl xl:col-span-2 rounded-[10px] border border-border bg-surface px-4 py-3 text-[13px] text-ink">
          {GOOGLE_BANNER_COPY[banner]}
        </div>
      )}

      {/* COLUMN 1 — Automation & calendar */}
      <div className="flex flex-col gap-6 min-w-0">
        <section className="max-w-xl">
          <h2 className="font-head font-semibold text-[15px] mb-3">Automation</h2>
          <ToggleList
            rows={ROWS}
            onToggle={(row, next) =>
              toast.push(`${row.title} turned ${next ? "on" : "off"}`, { tone: next ? "success" : "default" })
            }
          />
        </section>

        <section className="max-w-xl">
          <h2 className="font-head font-semibold text-[15px] mb-3">Calendar</h2>
          <div className="card divided overflow-hidden">
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 w-9 h-9 rounded-[9px] bg-surface-2 border border-border flex items-center justify-center shrink-0">
                  <CalendarDays size={17} className="text-ink-muted" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">Google Calendar</p>
                  {googleLoading ? (
                    <div className="mt-2 space-y-2">
                      <Skeleton className="h-3.5 w-64 max-w-full" />
                      <Skeleton className="h-3.5 w-44 max-w-full" />
                    </div>
                  ) : (
                    <p className="text-[12px] text-ink-muted mt-0.5">
                      {google.connected
                        ? `Connected — syncing to ${google.calendarId ?? "primary"}.`
                        : "Connect Google Calendar to auto-schedule jobs."}
                    </p>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                {google.connected ? (
                  <button
                    type="button"
                    onClick={() => void disconnectCalendar()}
                    disabled={disconnecting}
                    className="btn btn-ghost"
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void connectCalendar()}
                    disabled={googleLoading}
                    className="btn btn-primary"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* COLUMN 2 — Profile & account */}
      <section className="max-w-xl">
        <h2 className="font-head font-semibold text-[15px] mb-3">Profile & account</h2>
        <div className="card divided overflow-hidden">
          {sessionLoading ? (
            <AccountCardSkeleton />
          ) : !user ? (
            <div className="p-4">
              <p className="text-[13.5px] font-medium">Not signed in</p>
              <p className="text-[12px] text-ink-muted mt-0.5">Sign in to manage your account.</p>
            </div>
          ) : (
            <>
              <NameRow onSaved={refresh} />
              <EmailRow onSaved={refresh} />
              <PhoneRow onSaved={refresh} />
              <PasswordBlock />
              <SignOutRow />
            </>
          )}
        </div>
      </section>
    </div>
  );
}