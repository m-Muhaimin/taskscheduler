/**
 * Auth adapter — wired to the tradescheduler API (apps/api).
 *
 * The API issues a JWT ({ token, user }) on login/register and the *web*
 * owns the session cookie `ts_session` (7-day, path=/). The token must be
 * sent back as `Authorization: Bearer` — the API's requireAuth gate does
 * not read cookies — so authedFetch attaches the header from the cookie.
 * The Next middleware (middleware.ts) presence-gates /dashboard on the same
 * cookie.
 *
 * Error contract (from apps/api/src/routes/auth.ts):
 *   register -> 201 {token,user} | 400 invalid_body | 409 email_taken | 500/503 server_not_configured
 *   login    -> 200 {token,user} | 400 invalid_body | 401 invalid_credentials | 500/503 server_not_configured
 *   me       -> 200 {user}       | 401 missing_token / invalid_token | 500 server_not_configured
 */

export interface Session {
  name: string;
  email: string;
}

export type AuthField = "email" | "password";

export class AuthError extends Error {
  field?: AuthField;

  constructor(message: string, field?: AuthField) {
    super(message);
    this.name = "AuthError";
    this.field = field;
  }
}

export const SESSION_COOKIE = "ts_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function setSessionCookie(token: string): void {
  const maxAge = SESSION_MAX_AGE_SECONDS;
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function clearSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

export function getSessionToken(): string | null {
  const prefix = `${SESSION_COOKIE}=`;
  const part = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix));
  if (!part) return null;
  try {
    return decodeURIComponent(part.slice(prefix.length));
  } catch {
    return part.slice(prefix.length);
  }
}

/** fetch that attaches the session JWT as `Authorization: Bearer` when present. */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

/** Maps API error codes + HTTP status to human copy for the forms. */
export function authErrorMessage(status: number, code?: string): string {
  switch (code) {
    case "invalid_body":
      return "Check the details above and try again.";
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_taken":
      return "An account with this email already exists. Sign in instead.";
    case "missing_token":
    case "invalid_token":
      return "Your session has expired. Sign in again.";
    case "server_not_configured":
      return "The server isn't fully configured yet. Ask the admin to finish setup.";
    default:
      return status >= 500
        ? "Something went wrong on our end. Try again in a few minutes."
        : "Something went wrong. Try again.";
  }
}

export async function signIn(input: { email: string; password: string }): Promise<Session> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: input.email.trim(), password: input.password }),
  });
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const code = (body as { error?: string } | null)?.error;
    throw new AuthError(authErrorMessage(res.status, code), code === "invalid_body" ? "email" : undefined);
  }

  const { token, user } = body as {
    token: string;
    user: { id: string; email: string; displayName: string };
  };
  setSessionCookie(token);
  return { name: user.displayName, email: user.email };
}

/**
 * Signup adapter (T4): the signup form collects a business name, but the
 * register API does not take one — `business` is accepted here and dropped
 * before the payload is built, so the field stays in the UI without ever
 * reaching POST /api/auth/register.
 */
export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  business?: string;
}): Promise<Session> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: input.name.trim(),
      email: input.email.trim(),
      password: input.password,
    }),
  });
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const code = (body as { error?: string } | null)?.error;
    throw new AuthError(
      authErrorMessage(res.status, code),
      code === "email_taken" || code === "invalid_body" ? "email" : undefined,
    );
  }

  const { token, user } = body as {
    token: string;
    user: { id: string; email: string; displayName: string };
  };
  setSessionCookie(token);
  return { name: user.displayName, email: user.email };
}

/**
 * Not wired to a real email provider yet (no SMTP/email infra in apps/api).
 * Stays local-only so the forgot-password flow still renders its success
 * state. Revisit when email delivery lands.
 */
export async function requestPasswordReset(_input: { email: string }): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 600));
}
