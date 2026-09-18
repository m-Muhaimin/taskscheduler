"use client"

import { useCallback, useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { authedFetch } from "@/lib/auth-client"
import type { GoogleConnectionStatus } from "@tradescheduler/shared"

/**
 * Google Calendar connect/disconnect (CP06 real OAuth wiring).
 *
 * The consent URL comes from GET /api/auth/google/start via authedFetch (the
 * JWT lives in the ts_session cookie and must ride the Authorization header —
 * a plain <a href> navigation would 401), then the browser follows it to
 * Google. The callback lands back on /dashboard/settings?google=… which this
 * card turns into a one-shot status banner (param stripped afterwards).
 */
type Feedback = { kind: "ok" | "warn" | "error"; text: string } | null

function feedbackFromQuery(): Feedback {
  if (typeof window === "undefined") return null
  const param = new URLSearchParams(window.location.search).get("google")
  if (param === "connected") return { kind: "ok", text: "Google Calendar connected." }
  if (param === "denied") return { kind: "warn", text: "Google Calendar connection was cancelled." }
  if (param === "error") return { kind: "error", text: "Couldn’t connect Google Calendar. Try again." }
  return null
}

export function GoogleCalendarCard() {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [checkError, setCheckError] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(() => feedbackFromQuery())

  const refresh = useCallback(async () => {
    setChecking(true)
    setCheckError(false)
    try {
      const res = await authedFetch("/api/auth/google/status")
      if (!res.ok) throw new Error(String(res.status))
      setStatus(await (res.json() as Promise<GoogleConnectionStatus>))
    } catch {
      setCheckError(true)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Strip the one-shot ?google= param so a reload doesn't repeat the banner.
    if (window.location.search.includes("google=")) {
      history.replaceState(null, "", window.location.pathname)
    }
  }, [refresh])

  const connect = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await authedFetch("/api/auth/google/start")
      if (!res.ok) {
        setFeedback({ kind: "error", text: "Couldn’t start connecting to Google Calendar." })
        return
      }
      const { url } = (await res.json()) as { url: string }
      window.location.assign(url)
    } catch {
      setFeedback({ kind: "error", text: "Couldn’t start connecting to Google Calendar." })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await authedFetch("/api/auth/google", { method: "DELETE" })
      if (!res.ok) throw new Error(String(res.status))
      setFeedback({ kind: "ok", text: "Google Calendar disconnected." })
      await refresh()
    } catch {
      setFeedback({ kind: "error", text: "Couldn’t disconnect Google Calendar." })
    } finally {
      setBusy(false)
    }
  }

  const connected = status?.connected ?? false

  return (
    <Card>
      <CardContent>
        <CardTitle className="font-semibold">Google Calendar</CardTitle>
        <CardDescription className="mt-1">
          Powers availability checks and automatic event creation for reschedules.
        </CardDescription>

        {feedback && (
          <Alert
            className={
              "mt-2.5 " +
              (feedback.kind === "ok"
                ? ""
                : feedback.kind === "warn"
                  ? "border-amber-500/40"
                  : "border-destructive/40")
            }
          >
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-3 text-sm">
          <span className="shrink-0 text-muted-foreground">Status</span>
          <span className="font-medium">
            {checking
              ? "Checking…"
              : checkError
                ? "Unavailable"
                : connected
                  ? `Connected${status?.calendarId ? ` (${status.calendarId})` : ""}`
                  : "Not connected"}
          </span>
        </div>

        {connected && (
          <>
            <Separator className="my-2.5" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">Calendar</span>
              <span className="truncate font-medium text-sm tabular-nums">
                {status?.calendarId ?? "—"}
              </span>
            </div>
          </>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {connected ? (
            <Button variant="outline" disabled={busy} className="h-11 w-full lg:h-9" onClick={disconnect}>
              Disconnect Google Calendar
            </Button>
          ) : (
            <Button disabled={busy || checking} className="h-11 w-full lg:h-9" onClick={connect}>
              Connect Google Calendar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
