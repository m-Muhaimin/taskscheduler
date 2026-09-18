"use client"

import type { ReactNode } from "react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSession } from "@/lib/session"

/**
 * Holds the dashboard shell back until the session is verified, so fixture
 * content never renders for a visitor whose token has gone stale mid-session.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const { status, error, retry, retryable, signOut } = useSession()

  if (status === "loading") {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 pt-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <Alert variant="destructive">
          <AlertTitle>Can&rsquo;t load your schedule</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          {retryable ? (
            <AlertAction>
              <Button size="sm" variant="outline" onClick={retry}>
                Try again
              </Button>
            </AlertAction>
          ) : (
            <AlertAction>
              <Button size="sm" variant="outline" onClick={signOut}>
                Sign in again
              </Button>
            </AlertAction>
          )}
        </Alert>
      </div>
    )
  }

  // "unauthenticated" / "expired" — the provider is redirecting to /login.
  if (status !== "authenticated") return null

  return <>{children}</>
}
