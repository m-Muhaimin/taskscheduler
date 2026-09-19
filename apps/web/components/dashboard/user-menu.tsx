"use client";

import { LogOut } from "lucide-react";
import { useSession } from "@/lib/session";

function initialsOf(name: string | undefined | null): string {
  if (!name) return "U";
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Nav-rail identity block. Replaces the fixture "Marcus Jenner" + login link
 * with the real session user; sign-out clears the `ts_session` cookie (real
 * session clear) and routes back to /login via SessionProvider's signOut.
 */
export function UserMenu() {
  const { user, loading, signOut } = useSession();
  const name = user?.displayName ?? "User";

  return (
    <>
      <div className="flex items-center gap-2.5 px-1">
        <div className="w-7 h-7 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[11px] font-mono text-ink-muted">
          {loading ? "…" : initialsOf(user?.displayName)}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium truncate">{name}</p>
          <p className="text-[11px] text-ink-faint truncate">Owner</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        className="nav-item mt-2 w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[14px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <LogOut size={17} className="shrink-0" aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </>
  );
}