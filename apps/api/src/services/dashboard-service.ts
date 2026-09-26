/**
 * Dashboard query layer (T2+T3) — org-scoped reads for the new dashboard UI.
 *
 * Every function takes (organizationId, timezone) and returns the T1 DTOs from
 * @tradescheduler/shared. Empty/zero data always produces a valid zero DTO —
 * never throws, never null arrays.
 *
 * Conventions (repo-wide):
 *  - Lazy singleton Pool per file; DATABASE_URL read on first use (env-free boot).
 *  - Table names via env override with rl_ default (process.env.X_TABLE ?? 'rl_x').
 *  - Day bucketing via SQL: (ts AT TIME ZONE $tz)::date — tz is always a
 *    parameter (org tz from rl_organizations.timezone).
 *
 * Known schema constraints (surfaced here, not invented):
 *  - rl_appointments.status has NO completed/in-progress values — the jobs
 *    status map stops at what the DB supports ('Completed'/'In progress' are
 *    future states, per the T2+T3 brief).
 *  - rl_ai_usage carries organization_id (nullable, T9/RL_010) — aiCostByDay
 *    is org-scoped (NULL-org rows are excluded); noted in the analytics
 *    response type comment too.
 *  - rl_escalations has NO org column — escalations are attributed to an org
 *    only via customer_phone joining org conversations/customers.
 */

import { Pool } from 'pg';
import type {
  AppointmentDto,
  DashboardAnalyticsResponse,
  DashboardCustomersResponse,
  DashboardJobsResponse,
  DashboardScheduleResponse,
  DashboardSummaryResponse,
  InboxChannel,
  InboxItemDto,
  InboxItemState,
  MetricCardDto,
  MetricTrendDto,
  OutcomeDto,
  RevenueRecoveryDto,
  ScheduleDayDto,
  ScheduleItemDto,
  SeriesPointDto,
  TopServiceDto,
  TechnicianLoadDto,
  JobRowDto,
  CustomerDto,
} from '@tradescheduler/shared';

// ---------------------------------------------------------------------------
// Lazy pool
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

function q<T extends pgQueryResultRow>(text: string, params: unknown[]): Promise<{ rows: T[] }> {
  return getPool().query<T>(text, params);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type pgQueryResultRow = Record<string, any>;

// ---------------------------------------------------------------------------
// Table helpers (env override, rl_ default)
// ---------------------------------------------------------------------------

function appointmentsTable(): string {
  return process.env.APPOINTMENTS_TABLE ?? 'rl_appointments';
}
function customersTable(): string {
  return process.env.CUSTOMERS_TABLE ?? 'rl_customers';
}
function conversationsTable(): string {
  return process.env.CONVERSATIONS_TABLE ?? 'rl_conversations';
}
function messagesTable(): string {
  return process.env.MESSAGES_TABLE ?? 'rl_messages';
}
function conversationStatesTable(): string {
  return process.env.CONVERSATION_STATES_TABLE ?? 'rl_conversation_states';
}
function organizationMembersTable(): string {
  return process.env.ORGANIZATION_MEMBERS_TABLE ?? 'rl_organization_members';
}
function escalationsTable(): string {
  return process.env.ESCALATIONS_TABLE ?? 'rl_escalations';
}
function aiUsageTable(): string {
  return process.env.AI_USAGE_TABLE ?? 'rl_ai_usage';
}
function tradespeopleTable(): string {
  return process.env.TRADESPEOPLE_TABLE ?? 'rl_tradespeople';
}

// ---------------------------------------------------------------------------
// Date/time helpers (org-tz aware; day boundaries always computed in SQL)
// ---------------------------------------------------------------------------

/** Today's local date and this week's Monday (Monday..Sunday), in org tz. */
export async function getOrgNow(tz: string): Promise<{ today: string; monday: string }> {
  const { rows } = await q<{ today: string; monday: string }>(
    `select (now() at time zone $1)::date::text as today,
            (date_trunc('week', now() at time zone $1))::date::text as monday`,
    [tz],
  );
  return { today: rows[0]!.today, monday: rows[0]!.monday };
}

/** Add (or subtract) whole days to an ISO date string; timezone-free UTC math. */
function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/** Build a dense daily series (oldest -> newest) from a sparse day->value map. */
function seriesFromMap(map: Map<string, number>, start: string, days: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < days; i++) out.push(map.get(addDays(start, i)) ?? 0);
  return out;
}

function seriesPointsFromMap(map: Map<string, number>, start: string, days: number): SeriesPointDto[] {
  const out: SeriesPointDto[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    out.push({ date: d, value: map.get(d) ?? 0 });
  }
  return out;
}

/** Local wall-clock 'h:mm' 12h (e.g. "9:00", "2:30") in org tz. */
function formatLocalTime(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** Local weekday + time, e.g. "Mon 9:00". */
function formatLocalWeekdayTime(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${weekday} ${hour}:${minute}`;
}

/** Minutes since local midnight (for the today timeline topPercent). */
function localMinutesSinceMidnight(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** Relative time per the brief: "Xs ago" < 60s, "Xm ago" < 60m, "Xh ago" < 24h,
 *  "Yesterday" < 48h, else org-tz "Sep 12". */
function formatRelative(iso: string, tz: string, nowMs: number): string {
  const diffSec = Math.floor((nowMs - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffHr < 48) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** USD currency for the jobs table; "—" when no deposit (brief §getJobs). */
function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  const integer = Number.isInteger(n);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: integer ? 0 : 2,
    maximumFractionDigits: integer ? 0 : 2,
  }).format(n);
}

/**
 * Trend per the brief: current day vs mean of previous 6 days, pct rounded.
 * prior 0 && current > 0 -> "+100% vs last week" (up); both 0 -> "—" (flat).
 * `goodUp` — is an upward move good for this metric (false = down is good).
 */
function buildTrend(chart: number[], goodUp: boolean): MetricTrendDto | undefined {
  if (chart.length < 2) return undefined;
  const current = chart[chart.length - 1]!;
  const priorArr = chart.slice(0, -1);
  const priorMean = priorArr.reduce((a, b) => a + b, 0) / priorArr.length;
  if (priorMean === 0) {
    if (current > 0) {
      return { deltaLabel: '+100% vs last week', direction: 'up', good: goodUp };
    }
    return { deltaLabel: '—', direction: 'flat', good: true };
  }
  const pct = Math.round(((current - priorMean) / priorMean) * 100);
  const direction: MetricTrendDto['direction'] = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const good = direction === 'up' ? goodUp : direction === 'down' ? !goodUp : true;
  return { deltaLabel: `${pct > 0 ? '+' : ''}${pct}% vs last week`, direction, good };
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

// ---------------------------------------------------------------------------
// getSummary
// ---------------------------------------------------------------------------

export async function getSummary(orgId: string, tz: string): Promise<DashboardSummaryResponse> {
  const now = await getOrgNow(tz);
  const seriesStart = addDays(now.today, -6); // last 7 days incl today
  const weekStart = now.monday;
  const weekEnd = addDays(now.monday, 7); // exclusive

  const [todayCounts, leadsCounts, revenueCounts, rateRows, rateSeriesRows, attentionConvs, attentionEscs] =
    await Promise.all([
      // metric 1 — appointments today + 7d series
      q<{ d: string; c: number }>(
        `select (a.start_time at time zone $2)::date::text as d, count(*)::int as c
         from public.${appointmentsTable()} a
         where a.organization_id = $1 and a.status in ('pending','confirmed')
           and a.start_time >= ($3::date at time zone $2)
           and a.start_time < (($4::date + 1) at time zone $2)
         group by 1`,
        [orgId, tz, seriesStart, now.today],
      ),
      // metric 2 — new leads this week + 7d series
      q<{ d: string; c: number }>(
        `select (c.created_at at time zone $2)::date::text as d, count(*)::int as c
         from public.${customersTable()} c
         where c.organization_id = $1
           and c.created_at >= ($3::date at time zone $2)
           and c.created_at < (($4::date + 1) at time zone $2)
         group by 1`,
        [orgId, tz, seriesStart, now.today],
      ),
      // metric 3 — booked revenue this week (confirmed, in org-tz week)
      q<{ d: string; v: number }>(
        `select (a.start_time at time zone $2)::date::text as d, coalesce(sum(a.deposit_amount), 0)::float8 as v
         from public.${appointmentsTable()} a
         where a.organization_id = $1 and a.status = 'confirmed'
           and a.start_time >= ($3::date at time zone $2)
           and a.start_time < (($4::date + 1) at time zone $2)
         group by 1`,
        [orgId, tz, seriesStart, now.today],
      ),
      // metric 4 — ai booking rate (completed / total conversation states, org)
q<{ completed: number; total: number }>(
         `select count(*) filter (where s.state = 'completed')::int as completed, count(*)::int as total
          from public.${conversationStatesTable()} s
          where s.user_id in (select user_id from public.${organizationMembersTable()} where organization_id = $1)`,
         [orgId],
       ),
      q<{ d: string; completed: number; total: number }>(
        `select (s.created_at at time zone $2)::date::text as d,
                count(*) filter (where s.state = 'completed')::int as completed,
                count(*)::int as total
         from public.${conversationStatesTable()} s
         where s.user_id in (select user_id from public.${organizationMembersTable()} where organization_id = $1)
           and s.created_at >= ($3::date at time zone $2)
           and s.created_at < (($4::date + 1) at time zone $2)
         group by 1`,
        [orgId, tz, seriesStart, now.today],
      ),
      // metric 5 — escalated conversations (org)
      q<{ c: number }>(
        `select count(*)::int as c
         from public.${conversationsTable()} c
         where c.organization_id = $1 and c.status = 'escalated'`,
        [orgId],
      ),
      // metric 5 — pending escalations whose phone appears in org conversations
      q<{ c: number }>(
        `select count(*)::int as c
         from public.${escalationsTable()} e
         where e.status = 'pending'
           and exists (
             select 1 from public.${conversationsTable()} c
             join public.${customersTable()} cu on cu.id = c.customer_id
             where cu.organization_id = $1 and cu.phone = e.customer_phone
           )`,
        [orgId],
      ),
    ]);

  const todayMap = new Map(todayCounts.rows.map((r) => [r.d, r.c]));
  const leadsMap = new Map(leadsCounts.rows.map((r) => [r.d, r.c]));
  const revenueMap = new Map(revenueCounts.rows.map((r) => [r.d, r.v]));
  const rateSeriesMap = new Map<string, number>();
  for (const row of rateSeriesRows.rows) rateSeriesMap.set(row.d, pct(row.completed, row.total));

  const appointmentsToday = todayMap.get(now.today) ?? 0;
  const leadsThisWeek = leadsCounts.rows
    .filter((r) => r.d >= weekStart)
    .reduce((sum, r) => sum + r.c, 0);
  const bookedRevenue = revenueCounts.rows
    .filter((r) => r.d >= weekStart)
    .reduce((sum, r) => sum + r.v, 0);
  const aiRate = pct(rateRows.rows[0]?.completed ?? 0, rateRows.rows[0]?.total ?? 0);
  const needAttention = (attentionConvs.rows[0]?.c ?? 0) + (attentionEscs.rows[0]?.c ?? 0);

  const chartToday = seriesFromMap(todayMap, seriesStart, 7);
  const chartLeads = seriesFromMap(leadsMap, seriesStart, 7);
  const chartRevenue = seriesFromMap(revenueMap, seriesStart, 7);
  const chartRate = seriesFromMap(rateSeriesMap, seriesStart, 7);

  // metric 5 per-day chart: escalated conversations by updated_at + pending
  // escalations (phone in org) by created_at — same measure as the card.
  const [escalatedConvs, pendingEscs] = await Promise.all([
    q<{ d: string; c: number }>(
      `select (c.updated_at at time zone $2)::date::text as d, count(*)::int as c
       from public.${conversationsTable()} c
       where c.organization_id = $1 and c.status = 'escalated'
         and c.updated_at >= ($3::date at time zone $2)
         and c.updated_at < (($4::date + 1) at time zone $2)
       group by 1`,
      [orgId, tz, seriesStart, now.today],
    ),
    q<{ d: string; c: number }>(
      `select (e.created_at at time zone $2)::date::text as d, count(*)::int as c
       from public.${escalationsTable()} e
       where e.status = 'pending'
         and exists (
           select 1 from public.${conversationsTable()} c
           join public.${customersTable()} cu on cu.id = c.customer_id
           where cu.organization_id = $1 and cu.phone = e.customer_phone
         )
         and e.created_at >= ($3::date at time zone $2)
         and e.created_at < (($4::date + 1) at time zone $2)
       group by 1`,
      [orgId, tz, seriesStart, now.today],
    ),
  ]);
  const attentionMap = new Map<string, number>();
  for (const row of escalatedConvs.rows) attentionMap.set(row.d, (attentionMap.get(row.d) ?? 0) + row.c);
  for (const row of pendingEscs.rows) attentionMap.set(row.d, (attentionMap.get(row.d) ?? 0) + row.c);
  const chartAttention = seriesFromMap(attentionMap, seriesStart, 7);

  const metrics: MetricCardDto[] = [
    metric('appointments-today', 'Appointments today', appointmentsToday, chartToday, true, { href: '/dashboard/schedule' }),
    metric('new-leads', 'New leads this week', leadsThisWeek, chartLeads, true, { href: '/dashboard/customers' }),
    metric('booked-revenue', 'Booked this week', round2(bookedRevenue), chartRevenue.map(round2), true, { prefix: '$', tone: 'success', href: '/dashboard/jobs' }),
    metric('ai-booking-rate', 'AI booking rate', aiRate, chartRate, true, { suffix: '%', href: '/dashboard/analytics' }),
    metric('need-attention', 'Need attention', needAttention, chartAttention, false, {
      tone: needAttention > 0 ? 'danger' : 'default',
      href: '/dashboard/inbox',
    }),
  ];

  const [inbox, today, missedCalls, recovered, booked, avgDeposit, sparklineRows] = await Promise.all([
    getInboxItems(orgId, tz, 4),
    queryTodayAppointments(orgId, tz),
    q<{ c: number }>(
      `select count(*)::int as c
       from public.${conversationsTable()} c
       where c.organization_id = $1 and c.channel = 'voice'
         and c.created_at >= (date_trunc('month', now() at time zone $2) at time zone $2)`,
      [orgId, tz],
    ),
    q<{ c: number }>(
      `select count(*)::int as c
       from public.${conversationsTable()} c
       join public.${customersTable()} cu on cu.id = c.customer_id
       where c.organization_id = $1 and c.channel = 'voice'
         and c.created_at >= (date_trunc('month', now() at time zone $2) at time zone $2)
         and exists (
           select 1 from public.${appointmentsTable()} a
           where a.organization_id = $1 and a.customer_phone = cu.phone
             and a.created_at >= c.created_at
         )`,
      [orgId, tz],
    ),
    q<{ c: number }>(
      `select count(*)::int as c
       from public.${appointmentsTable()} a
       where a.organization_id = $1
         and a.created_at >= (date_trunc('month', now() at time zone $2) at time zone $2)`,
      [orgId, tz],
    ),
    q<{ v: number }>(
      `select coalesce(avg(a.deposit_amount), 0)::float8 as v
       from public.${appointmentsTable()} a
       where a.organization_id = $1 and a.status = 'confirmed'
         and a.start_time >= (date_trunc('month', now() at time zone $2) at time zone $2)
         and a.start_time < ((date_trunc('month', now() at time zone $2)) + interval '1 month') at time zone $2`,
      [orgId, tz],
    ),
    q<{ d: string; c: number }>(
      `select (a.created_at at time zone $2)::date::text as d, count(*)::int as c
       from public.${appointmentsTable()} a
       where a.organization_id = $1
         and a.created_at >= ($3::date at time zone $2)
         and a.created_at < (($4::date + 1) at time zone $2)
       group by 1`,
      [orgId, tz, addDays(now.today, -29), now.today],
    ),
  ]);

  const sparklineMap = new Map(sparklineRows.rows.map((r) => [r.d, r.c]));

  const revenueRecovery: RevenueRecoveryDto = {
    missedCalls: missedCalls.rows[0]?.c ?? 0,
    recovered: recovered.rows[0]?.c ?? 0,
    booked: booked.rows[0]?.c ?? 0,
    estimatedRevenue: round2((booked.rows[0]?.c ?? 0) * (avgDeposit.rows[0]?.v ?? 0)),
    sparkline: seriesFromMap(sparklineMap, addDays(now.today, -29), 30),
  };

  return { metrics, inbox, today, revenueRecovery };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type MetricOptions = {
  prefix?: string;
  suffix?: string;
  tone?: 'default' | 'success' | 'danger';
  href?: string;
};

function metric(
  id: string,
  label: string,
  value: number,
  chartData: number[],
  goodUp: boolean,
  opts: MetricOptions = {},
): MetricCardDto {
  return {
    id,
    label,
    value,
    prefix: opts.prefix,
    suffix: opts.suffix,
    tone: opts.tone,
    href: opts.href,
    trend: buildTrend(chartData, goodUp),
    chartData,
  };
}

/** Appointments today (pending/confirmed), ORDER BY start_time, enriched for
 *  the timeline (time, label, tech, topPercent, urgent). */
async function queryTodayAppointments(
  orgId: string,
  tz: string,
): Promise<AppointmentDto[]> {
  const { rows } = await q<{
    id: string;
    customer_phone: string;
    customer_name: string | null;
    service_description: string | null;
    start_time: string;
    user_id: string;
    display_name: string | null;
  }>(
    `select a.id, a.customer_phone, a.customer_name, a.service_description,
            a.start_time, a.user_id, tp.display_name
     from public.${appointmentsTable()} a
     left join public.${tradespeopleTable()} tp on tp.id = a.user_id
     where a.organization_id = $1 and a.status in ('pending','confirmed')
       and (a.start_time at time zone $2)::date = (now() at time zone $2)::date
     order by a.start_time`,
    [orgId, tz],
  );

  if (rows.length === 0) return [];

  // Phones needing attention: pending escalation with the same customer_phone,
  // or an escalated conversation with the same phone (org-scoped).
  const urgentPhones = new Set<string>();
  const [urgentEscs, urgentConvs] = await Promise.all([
    q<{ customer_phone: string }>(
      `select distinct customer_phone from public.${escalationsTable()} where status = 'pending'`,
      [],
    ),
    q<{ phone: string }>(
      `select distinct cu.phone as phone
       from public.${conversationsTable()} c
       join public.${customersTable()} cu on cu.id = c.customer_id
       where c.organization_id = $1 and c.status = 'escalated'`,
      [orgId],
    ),
  ]);
  for (const r of urgentEscs.rows) urgentPhones.add(r.customer_phone);
  for (const r of urgentConvs.rows) urgentPhones.add(r.phone);

  return rows.map((r) => {
    const minutesFromSix = localMinutesSinceMidnight(r.start_time, tz) - 6 * 60;
    const topPercent = Math.round(Math.min(92, Math.max(2, (minutesFromSix / (12 * 60)) * 100)));
    const label =
      r.service_description ??
      `Appointment with ${r.customer_name ?? r.customer_phone}`;
    return {
      id: r.id,
      time: formatLocalTime(r.start_time, tz),
      label,
      tech: r.display_name ?? 'Unassigned',
      topPercent,
      urgent: urgentPhones.has(r.customer_phone),
    };
  });
}

// ---------------------------------------------------------------------------
// getInboxItems
// ---------------------------------------------------------------------------

type InboxRow = {
  id: string;
  status: string;
  channel: string;
  updated_at: string;
  customer_name: string | null;
  customer_phone: string;
  last_message_body: string | null;
  outbound_body: string | null;
  state: string | null;
  offered_slots: InboxOfferedSlots | null;
  escalation_reason: string | null;
};

/** Shape of a conversation-state offered_slots jsonb value as surfaced by the
 *  inbox queries (optionNumber is 1|2|3 in the reserved schema but comes back
 *  as a plain number from jsonb). */
export type InboxOfferedSlots = Array<{ optionNumber: number; startTime: string; endTime: string }>;

const CHANNEL_LABEL: Record<string, InboxChannel> = {
  sms: 'SMS',
  voice: 'Voice',
  web: 'Web',
};

/**
 * Inbox suggestion derivation — single source of truth (T10): the same logic
 * drives the GET /api/dashboard/inbox `suggestion` field and POST
 * /api/dashboard/inbox/:conversationId/approve's server-derived body:
 *   last outbound body → else latest state's offered_slots top-2 times
 *   ("Offer slots: …") → else escalation_reason (state 'escalated' only)
 *   → else '' (approve returns 400 no_suggestion).
 */
export function deriveInboxSuggestion(opts: {
  outboundBody: string | null;
  state: string | null;
  offeredSlots: InboxOfferedSlots | null;
  escalationReason: string | null;
  tz: string;
}): string {
  let suggestion = opts.outboundBody ?? '';
  if (!suggestion && opts.state) {
    const slots = opts.offeredSlots;
    if (Array.isArray(slots) && slots.length > 0) {
      const times = slots.slice(0, 2).map((s) => formatLocalWeekdayTime(s.startTime, opts.tz));
      suggestion = `Offer slots: ${times.join(', ')}`;
    } else if (opts.state === 'escalated' && opts.escalationReason) {
      suggestion = opts.escalationReason;
    }
  }
  return suggestion;
}

export async function getInboxItems(orgId: string, tz: string, limit: number): Promise<InboxItemDto[]> {
  const { rows } = await q<InboxRow>(
    `select c.id, c.status, c.channel, c.updated_at,
            cu.name as customer_name, cu.phone as customer_phone,
            lm.body as last_message_body,
            om.body as outbound_body,
            st.state, st.offered_slots, st.escalation_reason
     from public.${conversationsTable()} c
     join public.${customersTable()} cu on cu.id = c.customer_id
     left join lateral (
       select m.body from public.${messagesTable()} m
       where m.conversation_id = c.id
       order by m.created_at desc
       limit 1
     ) lm on true
     left join lateral (
       select m.body from public.${messagesTable()} m
       where m.conversation_id = c.id and m.direction = 'outbound' and m.body is not null
       order by m.created_at desc
       limit 1
     ) om on true
     left join lateral (
       select s.state, s.offered_slots, s.escalation_reason
       from public.${conversationStatesTable()} s
       where s.phone = cu.phone
       order by s.created_at desc
       limit 1
     ) st on true
     where c.organization_id = $1
     order by c.updated_at desc
     limit $2`,
    [orgId, limit],
  );

  const nowMs = Date.now();
  const activeCutoff = nowMs - 24 * 60 * 60 * 1000;

  return rows.map((r) => {
    const updatedMs = new Date(r.updated_at).getTime();
    let state: InboxItemState;
    if (r.status === 'escalated') state = 'attention';
    else if (r.status === 'closed') state = 'handled';
    else state = updatedMs >= activeCutoff ? 'active' : 'attention';

    const suggestion = deriveInboxSuggestion({
      outboundBody: r.outbound_body,
      state: r.state,
      offeredSlots: r.offered_slots,
      escalationReason: r.escalation_reason,
      tz,
    });

    return {
      id: r.id,
      name: r.customer_name ?? r.customer_phone,
      state,
      lastMessage: r.last_message_body ?? 'Voice message',
      suggestion,
      time: formatRelative(r.updated_at, tz, nowMs),
      channel: CHANNEL_LABEL[r.channel] ?? r.channel as InboxChannel,
    };
  });
}

// ---------------------------------------------------------------------------
// getWeekSchedule
// ---------------------------------------------------------------------------

export async function getWeekSchedule(
  orgId: string,
  tz: string,
  weekStartISO: string,
  weekEndISO: string,
): Promise<DashboardScheduleResponse> {
  const { rows } = await q<{
    id: string;
    customer_phone: string;
    customer_name: string | null;
    start_time: string;
  }>(
    `select a.id, a.customer_phone, a.customer_name, a.start_time
     from public.${appointmentsTable()} a
     where a.organization_id = $1
       and a.start_time >= ($2::date at time zone $3)
       and a.start_time < ($4::date at time zone $3)
     order by a.start_time`,
    [orgId, weekStartISO, tz, weekEndISO],
  );

  // Response contract: exactly 7 day entries (weekStart..+6), regardless of
  // the allowed query window (the brief fixes days to 7 even for multi-week).
  // Bucket by the org-local calendar date of each appointment start.
  const byLocalDay = new Map<string, ScheduleItemDto[]>();
  for (const r of rows) {
    const [y, m, dd] = localDayOfIso(r.start_time, tz);
    const key = `${y}-${m}-${dd}`;
    const list = byLocalDay.get(key) ?? [];
    list.push({
      id: r.id,
      time: formatLocalTime(r.start_time, tz),
      customerName: r.customer_name ?? r.customer_phone,
    });
    byLocalDay.set(key, list);
  }

  const days: ScheduleDayDto[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStartISO, i);
    days.push({ date: d, items: byLocalDay.get(d) ?? [] });
  }

  return { weekStart: weekStartISO, weekEnd: weekEndISO, days };
}

/** Local (org-tz) calendar date parts of an instant, [y, m, d] zero-padded. */
function localDayOfIso(iso: string, tz: string): [string, string, string] {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return [get('year'), get('month'), get('day')];
}

// ---------------------------------------------------------------------------
// getJobs
// ---------------------------------------------------------------------------

// rl_appointments.status has no completed/in-progress value (schema constraint)
// — 'Completed'/'In progress' are future states; we must not invent them.
const JOB_STATUS_MAP: Record<string, JobRowDto['status']> = {
  confirmed: 'Scheduled',
  pending: 'Needs dispatch',
  rescheduled: 'Scheduled',
};

export async function getJobs(orgId: string, _tz: string): Promise<DashboardJobsResponse> {
  const { rows } = await q<{
    id: string;
    customer_phone: string;
    customer_name: string | null;
    service_description: string | null;
    deposit_amount: string | null;
    status: string;
    display_name: string | null;
  }>(
    `select a.id, a.customer_phone, a.customer_name, a.service_description,
            a.deposit_amount, a.status, tp.display_name
     from public.${appointmentsTable()} a
     left join public.${tradespeopleTable()} tp on tp.id = a.user_id
     where a.organization_id = $1
     order by a.start_time desc
     limit 100`,
    [orgId],
  );

  return {
    jobs: rows.map((r) => ({
      id: r.id,
      customer: r.customer_name ?? r.customer_phone,
      service: r.service_description ?? '—',
      technician: r.display_name ?? 'Unassigned',
      status: JOB_STATUS_MAP[r.status] ?? 'Needs dispatch',
      value: formatMoney(r.deposit_amount),
    })),
  };
}

// ---------------------------------------------------------------------------
// getCustomers
// ---------------------------------------------------------------------------

export async function getCustomers(orgId: string, tz: string): Promise<DashboardCustomersResponse> {
  const { rows } = await q<{
    id: string;
    name: string | null;
    phone: string;
    created_year: number;
    job_count: number;
  }>(
    `select cu.id, cu.name, cu.phone,
            extract(year from (cu.created_at at time zone $2))::int as created_year,
            (select count(*)::int from public.${appointmentsTable()} a
              where a.organization_id = cu.organization_id and a.customer_phone = cu.phone) as job_count
     from public.${customersTable()} cu
     where cu.organization_id = $1
     order by cu.created_at desc
     limit 100`,
    [orgId, tz],
  );

  const customers: CustomerDto[] = rows.map((r) => ({
    id: r.id,
    name: r.name ?? 'Unknown',
    phone: r.phone,
    jobCount: r.job_count,
    customerSince: String(r.created_year),
  }));
  return { customers };
}

// ---------------------------------------------------------------------------
// getAnalytics
// ---------------------------------------------------------------------------

export async function getAnalytics(orgId: string, tz: string): Promise<DashboardAnalyticsResponse> {
  const now = await getOrgNow(tz);
  const start = addDays(now.today, -29); // 30 days incl today
  const end = now.today;

  const [hourRows, outcomesRows, revenueRows, bookingsRows, rateRows, costRows, topServiceRows, techRows] =
    await Promise.all([
      // demandByHour — inbound messages, local hour of created_at
      q<{ h: number; c: number }>(
        `select extract(hour from (m.created_at at time zone $2))::int as h, count(*)::int as c
         from public.${messagesTable()} m
         join public.${conversationsTable()} c on c.id = m.conversation_id
         where c.organization_id = $1 and m.direction = 'inbound'
           and m.created_at >= ($3::date at time zone $2)
           and m.created_at < (($4::date + 1) at time zone $2)
         group by 1`,
        [orgId, tz, start, end],
      ),
      // outcomes
      q<{ booked: number; escalated: number; dropped: number }>(
        `select
           (select count(*)::int from public.${conversationStatesTable()} s
             where s.user_id in (select user_id from public.${organizationMembersTable()} where organization_id = $1)
               and s.state = 'completed') as booked,
           (select count(*)::int from public.${conversationStatesTable()} s
             where s.user_id in (select user_id from public.${organizationMembersTable()} where organization_id = $1)
               and s.state = 'escalated') as escalated,
           (select count(*)::int from public.${conversationsTable()} c
             where c.organization_id = $1 and c.status = 'closed'
               and not exists (select 1 from public.${conversationStatesTable()} s
                 join public.${customersTable()} cu on cu.phone = s.phone and cu.id = c.customer_id
                 where s.state = 'completed')) as dropped`,
        [orgId],
      ),
      // revenueByDay — confirmed deposit sum by local day
      q<{ date: string; value: number }>(
        `select g.d::date::text as date, coalesce(agg.v, 0)::float8 as value
         from generate_series($1::date, $2::date, interval '1 day') as g(d)
         left join (
           select (a.start_time at time zone $4)::date as d, sum(a.deposit_amount) as v
           from public.${appointmentsTable()} a
           where a.organization_id = $3 and a.status = 'confirmed'
             and a.start_time >= ($1::date at time zone $4)
             and a.start_time < (($2::date + 1) at time zone $4)
           group by 1
         ) agg on agg.d = g.d::date
         order by 1`,
        [start, end, orgId, tz],
      ),
      // bookingsByDay — created count by local day
      q<{ date: string; value: number }>(
        `select g.d::date::text as date, coalesce(agg.v, 0) as value
         from generate_series($1::date, $2::date, interval '1 day') as g(d)
         left join (
           select (a.created_at at time zone $4)::date as d, count(*)::int as v
           from public.${appointmentsTable()} a
           where a.organization_id = $3
             and a.created_at >= ($1::date at time zone $4)
             and a.created_at < (($2::date + 1) at time zone $4)
           group by 1
         ) agg on agg.d = g.d::date
         order by 1`,
        [start, end, orgId, tz],
      ),
      // aiBookingRateByDay — completed / total states per local day (org)
      q<{ date: string; value: number }>(
        `select g.d::date::text as date,
                case when coalesce(agg.total, 0) = 0 then 0
                     else round((coalesce(agg.completed, 0)::float8 / agg.total::float8) * 100)::int
                end as value
         from generate_series($1::date, $2::date, interval '1 day') as g(d)
         left join (
           select (s.created_at at time zone $4)::date as d,
                  count(*) filter (where s.state = 'completed')::int as completed,
                  count(*)::int as total
           from public.${conversationStatesTable()} s
           where s.user_id in (select user_id from public.${organizationMembersTable()} where organization_id = $3)
             and s.created_at >= ($1::date at time zone $4)
             and s.created_at < (($2::date + 1) at time zone $4)
           group by 1
         ) agg on agg.d = g.d::date
         order by 1`,
        [start, end, orgId, tz],
      ),
      // aiCostByDay — org-scoped series: rl_ai_usage now carries
      // organization_id (T9/RL_010); NULL-org rows are excluded along with
      // other orgs' — noted in the shared DashboardAnalyticsResponse type comment.
      q<{ date: string; value: number }>(
        `select g.d::date::text as date, coalesce(agg.v, 0)::float8 as value
         from generate_series($1::date, $2::date, interval '1 day') as g(d)
         left join (
           select (u.created_at at time zone $4)::date as d, sum(u.estimated_cost_usd) as v
           from public.${aiUsageTable()} u
           where u.organization_id = $3
             and u.created_at >= ($1::date at time zone $4)
             and u.created_at < (($2::date + 1) at time zone $4)
           group by 1
         ) agg on agg.d = g.d::date
         order by 1`,
        [start, end, orgId, tz],
      ),
      // topServices — non-null service_description, count desc
      q<{ service: string; count: number }>(
        `select a.service_description as service, count(*)::int as count
         from public.${appointmentsTable()} a
         where a.organization_id = $1 and a.service_description is not null
         group by a.service_description
         order by count desc, service asc
         limit 5`,
        [orgId],
      ),
      // technicianLoad — count per user_id, join display_name
      q<{ name: string; count: number }>(
        `select coalesce(tp.display_name, 'Unassigned') as name, count(*)::int as count
         from public.${appointmentsTable()} a
         left join public.${tradespeopleTable()} tp on tp.id = a.user_id
         where a.organization_id = $1
         group by 1
         order by count desc, name asc
         limit 5`,
        [orgId],
      ),
    ]);

  // demandByHour: fill all 24 buckets
  const demandByHour: number[] = new Array(24).fill(0);
  for (const r of hourRows.rows) {
    if (r.h >= 0 && r.h < 24) demandByHour[r.h] = r.c;
  }

  // outcomes: pct of total, rounded; empty array when nothing at all
  const o = outcomesRows.rows[0];
  const outcomes: OutcomeDto[] = [];
  const total = (o?.booked ?? 0) + (o?.escalated ?? 0) + (o?.dropped ?? 0);
  if (total > 0) {
    outcomes.push({ label: 'Booked', pct: pct(o!.booked, total), tone: 'success' });
    outcomes.push({ label: 'Escalated', pct: pct(o!.escalated, total), tone: 'danger' });
    outcomes.push({ label: 'Dropped', pct: pct(o!.dropped, total), tone: 'muted' });
  }

  return {
    demandByHour,
    outcomes,
    revenueByDay: revenueRows.rows,
    bookingsByDay: bookingsRows.rows,
    aiBookingRateByDay: rateRows.rows,
    aiCostByDay: costRows.rows,
    topServices: toTopServices(topServiceRows.rows),
    technicianLoad: toTechnicianLoad(techRows.rows),
  };
}

function toTopServices(rows: Array<{ service: string; count: number }>): TopServiceDto[] {
  return rows.map((r) => ({ service: r.service, count: r.count }));
}

function toTechnicianLoad(rows: Array<{ name: string; count: number }>): TechnicianLoadDto[] {
  return rows.map((r) => ({ name: r.name, count: r.count }));
}