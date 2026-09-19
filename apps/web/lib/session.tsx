"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { authedFetch, clearSessionCookie, getSessionToken } from "@/lib/auth";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  phoneNumber: string | null;
}

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetches GET /api/auth/me and replaces the user in context. Used by
   *  the settings page after a successful PATCH /api/auth/profile so the
   *  sidebar/greeting reflect the saved display name / email / phone. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
  refresh: async () => {},
});

/**
 * Client session provider for the dashboard shell. Hydrates the current user
 * from GET /api/auth/me when a `ts_session` cookie is present; clears the
 * cookie when the token is rejected. The middleware gate owns route access;
 * this owns display identity + sign-out.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!getSessionToken()) {
      setLoading(false);
      return;
    }
    authedFetch("/api/auth/me")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          clearSessionCookie();
          setUser(null);
        } else {
          const body = (await res.json()) as { user: SessionUser };
          setUser(body.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearSessionCookie();
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    clearSessionCookie();
    setUser(null);
    router.push("/login");
  }, [router]);

  /** Silent refresh: does not flip `loading` (so the shell never re-skeletons);
   *  only replaces the user on success. A rejected token clears the session,
   *  mirroring hydration semantics; transient network errors leave state as-is. */
  const refresh = useCallback(async () => {
    if (!getSessionToken()) return;
    try {
      const res = await authedFetch("/api/auth/me");
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) {
          clearSessionCookie();
          setUser(null);
        }
        return;
      }
      const body = (await res.json()) as { user: SessionUser };
      setUser(body.user);
    } catch {
      // transient failure — keep the current user; the next action re-checks.
    }
  }, []);

  const value = useMemo(() => ({ user, loading, signOut, refresh }), [user, loading, signOut, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
