"use client"

import { useState } from "react"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EscalationCard } from "@/components/escalation-card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardData } from "@/lib/use-dashboard-data"
import { toast } from "sonner"

/** Dashboard escalations list (brief §5.3 / Step 9) — fixture-backed until the API lands. */
export default function EscalationsPage() {
  const { loadState, escalations, retry, resolveEscalation } = useDashboardData()
  const [confirming, setConfirming] = useState<string | null>(null)

  const showLoading = loadState === "loading"
  const showError = loadState === "error"
  const showEmpty = loadState === "ready" && escalations.length === 0
  const pendingCount = escalations.filter((e) => e.status === "pending").length

  const handleResolve = () => {
    if (!confirming) return
    resolveEscalation(confirming)
    toast.success("Escalation resolved")
    setConfirming(null)
  }

  return (
    <div className="space-y-4">
      {showLoading && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {showError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load escalations.</AlertTitle>
          <AlertDescription>Check your connection and try again.</AlertDescription>
          <AlertAction>
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {showEmpty && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-none ring-0">
          No pending escalations — everything&apos;s under control.
        </div>
      )}

      {loadState === "ready" && escalations.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Requires attention</h2>
            {pendingCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {pendingCount} pending
              </span>
            )}
          </div>
          <div className="space-y-3">
            {escalations.map((e) => (
              <EscalationCard
                key={e.id}
                escalation={e}
                onResolve={() => setConfirming(e.id)}
              />
            ))}
          </div>
        </>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resolve escalation?</DialogTitle>
            <DialogDescription>Marking it resolved removes it from this list.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button onClick={handleResolve}>Resolve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
