# T1 — Shared dashboard DTO types (packages/shared)

Context: replacing apps/web with a new dashboard UI (H:\ridgeline-dashboard-auth-landing\apps\web)
that consumes real data from apps/api. These DTOs are the contract between the six new
/api/dashboard/* routes (built in T2/T3) and the UI (adopted in T4, wired in T5).

Scope: TYPES ONLY. No runtime code. Append a new section to
`H:\tradescheduling\packages\shared\src\types.ts` (auto-exported via index.ts `export * from './types.js'`).

The DTOs mirror the exact display shapes the new UI components consume (fixture types in
H:\ridgeline-dashboard-auth-landing\apps\web\lib\types.ts and component prop types), but with
string (uuid) ids. Keep ids as `string`; keep display fields server-computed strings.

## Types to add

```ts
// ── Dashboard DTO v2 (web replacement — T1) ────────────────────────────────
// Contract for the new dashboard UI. Display-ready: the server formats
// time strings, percents, currency, and trend deltas. Ids are uuid strings.

export type MetricTrendDto = {
  deltaLabel: string; // e.g. "+18% vs last week"
  direction: 'up' | 'down' | 'flat';
  good: boolean;      // whether this direction is good for this metric
};

export type MetricCardDto = {
  id: string;
  label: string;
  value: number;
  prefix?: string;    // e.g. "$"
  suffix?: string;    // e.g. "%" or "/wk"
  tone?: 'default' | 'success' | 'danger';
  trend?: MetricTrendDto;
  chartData: number[]; // 7-day daily series, oldest -> newest
  href?: string;       // card link target, e.g. "/dashboard/inbox"
};

export type InboxItemState = 'attention' | 'active' | 'handled';
export type InboxChannel = 'SMS' | 'Voice' | 'Web';

export type InboxItemDto = {
  id: string;
  name: string;          // customer name, fallback phone
  state: InboxItemState;
  lastMessage: string;
  suggestion: string;    // AI suggestion / latest outbound AI message
  time: string;          // relative display, e.g. "2m ago", "3h ago", "Yesterday"
  channel: InboxChannel;
};

export type AppointmentDto = {
  id: string;
  time: string;        // org-tz "9:00" (24h -> 12h display as fixtures show)
  label: string;       // service or "9:00 appointment with <name>"
  tech: string;        // technician display name
  topPercent: number;  // 0-100 vertical position on the day timeline
  urgent?: boolean;    // true when escalated/needs attention
};

export type RevenueRecoveryDto = {
  missedCalls: number;
  recovered: number;
  booked: number;
  estimatedRevenue: number; // currency number; UI prefixes "~$"
  sparkline: number[];      // 30-day recovered series, oldest -> newest
};

export type DashboardSummaryResponse = {
  metrics: MetricCardDto[];      // 5 cards
  inbox: InboxItemDto[];         // compact, top 4
  today: AppointmentDto[];       // today timeline
  revenueRecovery: RevenueRecoveryDto;
};

export type DashboardInboxResponse = {
  items: InboxItemDto[];
};

export type ScheduleItemDto = {
  id: string;
  time: string;      // org-tz "9:00" or "9:30"
  customerName: string;
};

export type ScheduleDayDto = {
  date: string;      // ISO date yyyy-mm-dd (org tz)
  items: ScheduleItemDto[]; // sorted by start time
};

export type DashboardScheduleResponse = {
  weekStart: string; // ISO date
  weekEnd: string;   // ISO date (exclusive)
  days: ScheduleDayDto[]; // Monday..Sunday, 7 entries
};

export type JobStatusType = 'Completed' | 'Scheduled' | 'In progress' | 'Needs dispatch';

export type JobRowDto = {
  id: string;
  customer: string;
  service: string;
  technician: string;
  status: JobStatusType;
  value: string; // formatted "$1,200" or "—" when no deposit
};

export type DashboardJobsResponse = {
  jobs: JobRowDto[];
};

export type CustomerDto = {
  id: string;
  name: string;     // fallback "Unknown" when null
  phone: string;
  jobCount: number;
  customerSince: string; // e.g. "2026" (created year)
};

export type DashboardCustomersResponse = {
  customers: CustomerDto[];
};

export type OutcomeDto = {
  label: string;    // e.g. "Booked", "Escalated", "Dropped"
  pct: number;      // 0-100
  tone: 'success' | 'danger' | 'muted';
};

export type SeriesPointDto = {
  date: string; // ISO date yyyy-mm-dd
  value: number;
};

export type TopServiceDto = { service: string; count: number };
export type TechnicianLoadDto = { name: string; count: number };

export type DashboardAnalyticsResponse = {
  demandByHour: number[];         // 24 buckets, 0..23 local org time
  outcomes: OutcomeDto[];         // booked / escalated / dropped, pct sums to 100
  revenueByDay: SeriesPointDto[];          // 30d
  bookingsByDay: SeriesPointDto[];         // 30d
  aiBookingRateByDay: SeriesPointDto[];    // 30d, 0-100 %
  aiCostByDay: SeriesPointDto[];           // 30d, $ (global — rl_ai_usage has no org col)
  topServices: TopServiceDto[];            // top 5 by appointment count
  technicianLoad: TechnicianLoadDto[];     // top 5 by appointment count
};

export type DashboardApiErrorResponse = {
  error: 'no_organization' | 'invalid_query' | 'server_error';
};
```

## Rules
- Follow the file's existing conventions: TYPES-ONLY, `export type` (project is TS with
  `verbatimModuleSyntax`-style; existing file uses plain `export type X = ...`).
- Do NOT rename or modify any existing types.
- Do NOT add runtime code.

## Verification
- `npm run typecheck --workspace=@tradescheduler/shared` (or the workspace's own check
  script — inspect packages/shared/package.json), or `npx tsc --noEmit` in packages/shared.
- Report: diff summary + typecheck result.
