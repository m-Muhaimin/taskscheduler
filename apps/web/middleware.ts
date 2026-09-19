import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate (ported from the tradescheduler web, adapted to RidgeLine routes).
 *
 * Presence-checked on the `ts_session` cookie — the JWT issued by
 * POST /api/auth/login. Real signature verification happens server-side in
 * the API (middleware/auth.ts); this gate only keeps the dashboard out of
 * reach without a session, and keeps signed-in users off the auth pages.
 */
export const SESSION_COOKIE = "ts_session";

const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (!hasSession && pathname.startsWith("/dashboard")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (hasSession && AUTH_PAGES.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup", "/forgot-password"],
};
