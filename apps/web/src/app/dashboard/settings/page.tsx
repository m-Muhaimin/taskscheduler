"use client"

import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { clearSessionCookie } from "@/lib/auth-client"
import { deviceTimezone, tzAbbr } from "@/lib/format"
import { useDashboardData } from "@/lib/use-dashboard-data"

/** Settings placeholder (brief §4.0): hours + SMS template drawn from fixtures. */
export default function SettingsPage() {
  const router = useRouter()
  const { user, businessTz } = useDashboardData()
  const tz = deviceTimezone()

  function signOut() {
    clearSessionCookie()
    router.replace("/login")
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <CardTitle className="font-semibold">Business hours</CardTitle>
          <CardDescription className="mt-1">When you take jobs.</CardDescription>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Hours</span>
            <span className="font-medium tabular-nums">
              {user.businessHours.start} – {user.businessHours.end}
            </span>
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Timezone</span>
            <span className="font-medium">
              {businessTz}
              {tz !== businessTz ? ` (${tzAbbr(businessTz)})` : ""}
            </span>
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Phone</span>
            <span className="font-medium tabular-nums">{user.phoneNumber}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <CardTitle className="font-semibold">SMS template</CardTitle>
          <CardDescription className="mt-1">Used for reschedule offers.</CardDescription>
          <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            {user.smsSettings.rescheduleTemplate}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <CardTitle className="font-semibold">Account</CardTitle>
          <CardDescription className="mt-1">
            Sign out of the dashboard on this device.
          </CardDescription>
          <Button variant="outline" className="mt-3 h-11 w-full" onClick={signOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Editing arrives in a later step.
      </p>
    </div>
  )
}