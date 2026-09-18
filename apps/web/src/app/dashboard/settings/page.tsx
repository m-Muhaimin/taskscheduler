"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { deviceTimezone, tzAbbr } from "@/lib/format"
import { useSession } from "@/lib/session"
import { useDashboardData } from "@/lib/use-dashboard-data"

/**
 * Settings (brief §4.0). The account block is live (auth session); hours, phone
 * and the SMS template are still fixtures — no profile API exists yet.
 */
export default function SettingsPage() {
  const { user, businessTz, sessionUser } = useDashboardData()
  const { signOut } = useSession()
  const tz = deviceTimezone()

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <CardTitle className="font-semibold">Business hours</CardTitle>
          <CardDescription className="mt-1">When you take jobs. Sample data.</CardDescription>
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
          <CardDescription className="mt-1">Signed in on this device.</CardDescription>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{sessionUser?.displayName}</span>
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">Email</span>
            <span className="truncate font-medium">{sessionUser?.email}</span>
          </div>
          <Button variant="outline" className="mt-4 h-11 w-full" onClick={signOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}