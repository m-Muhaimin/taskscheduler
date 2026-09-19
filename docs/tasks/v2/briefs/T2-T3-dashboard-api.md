# T2+T3 — Dashboard data layer + six real API routes (apps/api)

Context: replacing apps/web with a new dashboard UI (source: H:\ridgeline-dashboard-auth-landing\apps\web).
The six new pages (Overview, Inbox, Schedule, Jobs, Customers, Analytics) consume real data.
Existing dashboard routes (escalations, reschedule-history) are in-memory fixtures — the new
routes must query the live Supabase schema (rl_* tables) and return the DTOs defined in T1
(@tradescheduler/shared — read the appended section in packages/shared/src/types.ts first).

You build: (1) org-context lookup, (2) dashboard-service.ts query layer, (3) six routes,
(4) refactor the two existing dashboard routes onto the shared requireAuth middleware.

## Repo conventions (verified — follow exactly)
- Lazy singleton Pool per service file (copy from apps/api/src/services/organization-service.ts):
  let pool: Pool | null = null; getPool() creates new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: false } }); DATABASE_URL read on first use, never module scope.
- Table names via env override with rl_ default: process.env.X_TABLE ?? 'rl_x'.
- ESM + NodeNext: ALL relative imports use .js suffix (import { requireAuth } from '../../middleware/auth.js').
- Map snake_case DB rows to camelCase DTOs (see organization-service getOrganizationById).
- Timezone: org tz from rl_organizations.timezone (default 'America/New_York'). Day bucketing via SQL (ts AT TIME ZONE $tz)::date — parameterize tz.
- Zod (3.25.67) available for query validation (schedule weekStart/weekEnd).
- Typecheck: npm run typecheck --workspace=@tradescheduler/api. Tests: npm run test --workspace=@tradescheduler/api — existing suite must stay green.

## 1) Org context (edit apps/api/src/services/organization-service.ts — org domain owner)
Add:
  interface OrgContext { organizationId: string; timezone: string; }
  getOrgContextByUserId(userId: string): Promise<OrgContext | null>
SQL: select m.organization_id, o.timezone from public.rl_organization_members m
  join public.rl_organizations o on o.id = m.organization_id
  where m.user_id = $1 and o.status = 'active' limit 1
Env overrides for both tables (ORGANIZATION_MEMBERS_TABLE / ORGANIZATIONS_TABLE).

## 2) Dashboard service (NEW: apps/api/src/services/dashboard-service.ts)
Lazy pool + table helpers. Org-scoped everywhere. All functions take (organizationId, timezone).
Return types = T1 DTOs. Empty/zero data must produce valid zero DTOs — never throw, never null arrays.

Functions (against rl_appointments, rl_customers, rl_conversations, rl_messages,
rl_conversation_states, rl_escalations, rl_ai_usage, rl_tradespeople):

getSummary(orgId, tz) -> DashboardSummaryResponse
  Metrics (id, label, value, tone, href) in order:
  1. appointments-today / "Appointments today" / count org appointments WHERE (start_time AT TIME ZONE tz)::date = today AND status IN ('pending','confirmed') / default / /dashboard/schedule
  2. new-leads / "New leads this week" / count org customers WHERE created_at >= Monday 00:00 org-tz / default / /dashboard/customers
  3. booked-revenue / "Booked this week" / prefix '$' / SUM(deposit_amount) WHERE status='confirmed' AND start_time in this week org-tz (NULL->0) / success / /dashboard/jobs
  4. ai-booking-rate / "AI booking rate" / suffix '%' / completed rl_conversation_states (join conversation_id -> rl_conversations org) / total states for org, x100, 0 decimals / default / /dashboard/analytics
  5. need-attention / "Need attention" / count org conversations status='escalated' + count rl_escalations status='pending' whose customer_phone appears in org's conversations (escalations has no org column; if the join yields none, count zero — never global) / tone 'danger' when >0 else default / /dashboard/inbox
  Each metric: chartData = 7 daily points (last 7 days org-tz, oldest first) of the same measure; trend = compare current day vs mean of previous 6 days: pct rounded; prior 0 && current >0 -> "+100% vs last week" up good true; both 0 -> "—" flat good true. good: up is good for metrics 1-3, down is good for 5, up is good for 4.
  inbox: top 4 by updated_at desc (same shape as getInboxItems).
  today: appointments today (pending/confirmed) ORDER BY start_time -> AppointmentDto: time = local 'h:mm' 12h ("9:00"); label = service_description ?? "Appointment with <customer_name ?? phone>"; tech = display_name (join tradespeople) ?? "Unassigned"; topPercent = (minutes since 06:00 local)/(12*60)*100 clamped 2..92 rounded; urgent = EXISTS pending escalation with same customer_phone (or escalated conversation same phone).
  revenueRecovery: missedCalls = count org conversations channel='voice' created this calendar month org-tz; recovered = count of those voice conversations whose phone later has an org appointment (phone join); booked = count org appointments created this calendar month; estimatedRevenue = booked x AVG(deposit_amount) of org confirmed appointments this month (0 when none); sparkline = 30 daily counts of appointments created (oldest first).

getInboxItems(orgId, tz, limit) -> InboxItemDto[]
  rl_conversations org ORDER BY updated_at DESC LIMIT $limit (50 inbox page / 4 summary).
  name = rl_customers.name (join customer_id) ?? phone; channel map sms->'SMS', voice->'Voice', web->'Web';
  state: status='escalated'->'attention'; 'closed'->'handled'; 'open' -> updated_at within 24h ? 'active' : 'attention';
  lastMessage = latest rl_messages body (any direction) ?? "Voice message" when NULL (voice-before-transcript);
  suggestion = latest OUTBOUND rl_messages body; else latest rl_conversation_states (via conversation_id): offered_slots non-empty -> "Offer slots: " + first 2 slot start times ("Mon 9:00, Tue 1:00"); state='escalated' -> escalation_reason; else "";
  time = relative from updated_at: <60s "Xs ago"; <60m "Xm ago"; <24h "Xh ago"; <48h "Yesterday"; else "Mon D" ("Sep 12").
  Latest message per conversation: lateral join or DISTINCT ON (conversation_id) ORDER BY created_at DESC.

getWeekSchedule(orgId, tz, weekStartISO, weekEndISO) -> DashboardScheduleResponse
  zod: ^\d{4}-\d{2}-\d{2}$, weekStart < weekEnd, range <= 8 weeks, else 400 { error: 'invalid_query' }.
  rl_appointments org WHERE start_time >= weekStart 00:00 org-tz AND < weekEnd 00:00 org-tz.
  days = 7 entries (weekStart..+6); items sorted by start_time; time = local 'h:mm'; customerName = customer_name ?? phone.

getJobs(orgId, tz) -> DashboardJobsResponse
  rl_appointments org ORDER BY start_time DESC LIMIT 100. customer = customer_name ?? phone; service = service_description ?? "—";
  technician = display_name ?? "Unassigned"; status map: confirmed->'Scheduled', pending->'Needs dispatch', rescheduled->'Scheduled'
  (DB has no completed/in-progress column — do not invent; comment noting 'Completed'/'In progress' are future states);
  value = deposit_amount ? Intl currency USD (max 0 fraction digits when integer else 2) : "—".

getCustomers(orgId) -> DashboardCustomersResponse
  rl_customers org ORDER BY created_at DESC LIMIT 100. name ?? "Unknown"; jobCount = COUNT org appointments same customer_phone; customerSince = String(year created org-tz).

getAnalytics(orgId, tz) -> DashboardAnalyticsResponse (series: generate_series over last 30 org-tz days, LEFT JOIN aggregates, fill 0)
  demandByHour: number[24] — inbound rl_messages joined rl_conversations (org), 30d, bucketed by local hour of message created_at.
  outcomes: booked = COUNT states 'completed' (via conversation join org); escalated = COUNT 'escalated'; dropped = COUNT conversations closed WITHOUT completed state.
    pct = each/total x100, 0 decimals; tone booked->success, escalated->danger, dropped->muted. Labels "Booked"/"Escalated"/"Dropped". Total 0 -> empty array.
  revenueByDay: 30d SUM(deposit_amount) confirmed by local day.
  bookingsByDay: 30d COUNT appointments by local day.
  aiBookingRateByDay: 30d per-day completed/total states x100 (0 when none).
  aiCostByDay: 30d SUM(estimated_cost_usd) from rl_ai_usage by day. NO org column — global series; comment + note in report.
  topServices: GROUP BY service_description (non-null) COUNT DESC LIMIT 5 -> { service, count }.
  technicianLoad: COUNT per user_id JOIN tradespeople display_name LIMIT 5 -> { name, count }.

## 3) Routes (NEW files under apps/api/src/routes/dashboard/, one router per resource)
- summary.ts: GET / -> getSummary(org) -> res.json(summary)
- inbox.ts: GET / -> getInboxItems(org, tz, 50) -> { items }
- schedule.ts: GET /?weekStart&weekEnd -> zod-validate (default = current Monday..Sunday org-tz, enforce range) -> { weekStart, weekEnd, days }
- jobs.ts: GET / -> { jobs }
- customers.ts: GET / -> { customers }
- analytics.ts: GET / -> analytics response
- ALL use requireAuth from '../../middleware/auth.js' (req.auth = { userId }).
- Mount all six in routes/dashboard/index.ts: '/api/dashboard/summary', '/inbox', '/schedule', '/jobs', '/customers', '/analytics' (existing mount style: app.use('/api/dashboard/escalations', escalationsRouter)).
- Org resolution helper: ctx = await getOrgContextByUserId(req.auth.userId); if (!ctx) return res.status(403).json({ error: 'no_organization' });
- Errors: DB error -> console.error + 500 { error: 'server_error' }; validation -> 400 { error: 'invalid_query' }.
- REFACTOR: routes/dashboard/escalations.ts AND routes/dashboard/bookings/[bookingId]/reschedule-history.ts — replace inline authorize with shared requireAuth from middleware/auth.js (delete local authorize; keep everything else identical).

## 4) Live-data verification (do ALL)
1. npm run typecheck --workspace=@tradescheduler/api -> clean.
2. npm run test --workspace=@tradescheduler/api -> existing suite green.
3. Env: H:\tradescheduling\apps\api\.env (DATABASE_URL = Supabase pooler — reachable from this machine; direct db.<ref>.supabase.co is NOT reachable).
4. Live counts via scratch tsx/pg script (pooler, ssl rejectUnauthorized false): rl_organizations / rl_organization_members / rl_tradespeople. Report the numbers (answers whether the dashboard shows data).
5. Boot API (tsx src/index.ts) and hit every new route with a real Bearer token: obtain via POST /api/auth/login (find seeded creds in apps/api/.env or local-db.mjs/docs; if none, register a throwaway via POST /api/auth/register and note it for cleanup). Record status + compact body per route. Empty org must return zero-shaped 200s (correct — record it).
6. Fix any 500s.

## Report
Verification command + result each; org/member/tradesperson counts; per-route status + sample body; throwaway credentials (for cleanup); deviations; spots where the schema forced a semantic choice (job status map, suggestion fallback, aiCost global).

## Out of scope
- NO new tables/migrations. NO changes to auth/worker/twilio routes. NO UI work.
- No commits (controller handles git).
