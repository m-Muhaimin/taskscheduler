"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"

import {
  clearSessionCookie,
  getSessionToken,
  type AuthUser,
} from "@/lib/auth-client"
import { resolveSession, type SessionResult } from "@/lib/session-core"

type SessionValue = {
  status: SessionResult["status"]
  user: AuthUser | null
  /** Present when status === "error". */
  error: string | null
  retryable: boolean
  retry: () => void
  signOut: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

/**
 * Resolves the signed-in tradesperson once per dashboard mount.
 *
 * The middleware gate only checks that a cookie exists, so a stale or forged
 * token still reaches the shell — this is where it gets verified: on
 * "expired" the cookie is dropped and the user is sent back to /login.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [result, setResult] = useState<SessionResult>({ status: "loading" })

  const load = useCallback(async () => {
    setResult({ status: "loading" })
    const next = await resolveSession(getSessionToken())
    if (next.status === "expired") {
      clearSessionCookie()
      router.replace("/login")
    }
    setResult(next)
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const signOut = useCallback(() => {
    clearSessionCookie()
    setResult({ status: "unauthenticated" })
    router.replace("/login")
    router.refresh()
  }, [router])

  const value = useMemo<SessionValue>(
    () => ({
      status: result.status,
      user: result.status === "authenticated" ? result.user : null,
      error: result.status === "error" ? result.message : null,
      retryable: result.status === "error" ? result.retryable : false,
      retry: () => void load(),
      signOut,
    }),
    [result, load, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside <SessionProvider>")
  return value
}
