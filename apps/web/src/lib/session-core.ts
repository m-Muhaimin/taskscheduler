import { authErrorMessage, type AuthUser } from "@/lib/auth-client"

/**
 * Session resolution, kept free of React and of `document` so it can be
 * exercised headlessly (the provider in session.tsx owns the browser bits).
 */

export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "expired"
  | "error"

export type SessionResult =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  /** No token at all — never signed in on this browser. */
  | { status: "unauthenticated" }
  /** Token present but rejected (401/404): stale or tampered → sign in again. */
  | { status: "expired" }
  | { status: "error"; message: string; retryable: boolean }

function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.displayName === "string"
  )
}

/**
 * Turns a session token into a session result by asking GET /api/auth/me.
 * `fetchImpl` is injectable so tests can drive every branch without a server.
 */
export async function resolveSession(
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionResult> {
  if (!token) return { status: "unauthenticated" }

  let res: Response
  try {
    res = await fetchImpl("/api/auth/me", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
  } catch {
    return {
      status: "error",
      message: "Couldn't reach the server. Check your connection.",
      retryable: true,
    }
  }

  if (res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { status: "error", message: "Unexpected server response.", retryable: true }
    }
    const user = (body as { user?: unknown } | null)?.user
    if (!isAuthUser(user)) {
      return { status: "error", message: "Unexpected server response.", retryable: true }
    }
    return { status: "authenticated", user }
  }

  // 401 missing/invalid token and 404 deleted account both mean "sign in again".
  if (res.status === 401 || res.status === 404) return { status: "expired" }

  let error: string | undefined
  try {
    error = ((await res.json()) as { error?: string }).error
  } catch {
    error = undefined
  }
  return {
    status: "error",
    message: authErrorMessage(res.status, error),
    // 5xx is a server-side state (schema not migrated, secret unset) — retryable.
    retryable: res.status >= 500,
  }
}
