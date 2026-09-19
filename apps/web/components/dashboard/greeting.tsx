"use client";

import { useSession } from "@/lib/session";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard greeting. The name comes from the real session user
 * (SessionProvider hydrates it from GET /api/auth/me); the date line is the
 * today the browser sees (org-tz "today" lives in the API responses when it
 * matters — the schedule's weekStart default).
 */
export function Greeting() {
  const { user, loading } = useSession();
  const name = user?.displayName;
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="mb-5">
      <h2 className="h-page">
        Good morning,{" "}
        {loading ? (
          <Skeleton className="inline-block h-[0.9em] w-36 align-baseline" />
        ) : (
          name ?? "there"
        )}
        .
      </h2>
      <p className="text-ink-muted text-sm mt-1">{today} — here&apos;s where things stand.</p>
    </div>
  );
}