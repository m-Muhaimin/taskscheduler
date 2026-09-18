"use client"

/**
 * Shared client-side auth helpers used by the login/register pages and the
 * dashboard session layer.
 *
 * The session is a JWT issued by the API and carried in the `ts_session`
 * cookie (name shared with src/middleware.ts). The cookie is first-party
 * because /api/* is proxied through this origin (next.config.ts), so the
 * browser sends it on every request — but the API reads the token from the
 * `Authorization` header, so API calls must attach it explicitly.
 */

export const SESSION_COOKIE = "ts_session"
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // matches the API 7d token TTL

export type AuthUser = { id: string; email: string; displayName: string }

export function setSessionCookie(token: string): void {
  const secure = window.location.protocol === "https:" ? "; secure" : ""
  document.cookie =
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; path=/; ` +
    `max-age=${SESSION_MAX_AGE_SECONDS}; samesite=lax${secure}`
}

export function clearSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`
}

/** Raw session token from the `ts_session` cookie, or null when absent. */
export function getSessionToken(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  if (!match) return null
  const value = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1))
  return value.length > 0 ? value : null
}

/** `fetch` with the session token attached as `Authorization: Bearer …`.
 *  Callers own the response: 401 handling belongs to the session layer. */
export function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = getSessionToken()
  if (token) headers.set("authorization", `Bearer ${token}`)
  return fetch(path, { ...init, headers })
}

/** Maps an auth API failure onto copy a tradesperson can act on. */
export function authErrorMessage(status: number, error?: string): string {
  if (error === "invalid_credentials") return "Email or password is incorrect."
  if (error === "email_taken") return "That email is already registered. Sign in instead."
  if (error === "invalid_body") return "Check the details above and try again."
  if (status === 503 || error === "server_not_configured") {
    return "The server isn't fully configured yet. Ask the admin to finish setup."
  }
  if (status >= 500) return "Something went wrong on the server. Try again shortly."
  return "Something went wrong. Try again."
}
