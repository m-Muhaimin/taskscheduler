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
}

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
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

  const value = useMemo(() => ({ user, loading, signOut }), [user, loading, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
