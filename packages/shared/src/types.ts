// Shared domain types for tradescheduler.
// TYPES-ONLY package: import with `import type` / `export type` only.
// Field shapes follow docs/spec-reschedule-flow.md §2.7-2.9 and §3,
// and docs/prd-scheduling-assistant.md where the spec is silent.

/** ISO 8601 datetime string, as transported in JSON / stored in Postgres. */
export type IsoString = string;

export type BusinessHours = {
  /** Local wall-clock start, 24-hour 'HH:mm', e.g. '09:00'. */
  start: string;
  /** Local wall-clock end, 24-hour 'HH:mm', e.g. '17:00'. */
  end: string;
  /** IANA timezone name, e.g. 'America/New_York'. */
  timezone: string;
};

export type SmsSettings = {
  /** Template for the 3-slot reschedule offer SMS; slots interpolated at send time (§1.1). */
  rescheduleTemplate: string;
};

export type User = {
  id: string; // UUID
  phoneNumber: string; // tradesperson's phone, E.164
  googleCalendarId: string | null;
  businessHours: BusinessHours;
  smsSettings: SmsSettings;
};

export type BookingStatus = 'pending' | 'confirmed' | 'rescheduled';

export type SmsDirection = 'inbound' | 'outbound';

export type SmsMessage = {
  direction: SmsDirection;
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: IsoString;
  /**
   * Known values used by the flow:
   * 'reschedule-offer' | 'reschedule-confirm' | 'reschedule-no-slots' | 'unknown'
   * | 'invalid-choice' | 'help' | 'no-matching-booking'
   */
  aiIntent: string | null;
  /** 0..1; null when not an AI-classified message. */
  confidence: number | null;
};

export type RescheduleLogEntry = {
  action: 'reschedule-offer' | 'reschedule-confirm' | 'reschedule-completed' | 'reschedule-failed';
  /** ISO 8601 timestamp. */
  timestamp: IsoString;
  details: string;
};

export type Booking = {
  id: string; // UUID
  userId: string; // UUID
  customerPhone: string; // E.164
  customerName: string;
  serviceDescription: string;
  /** ISO 8601 datetime. */
  startTime: IsoString;
  /** ISO 8601 datetime. */
  endTime: IsoString;
  status: BookingStatus;
  /** 'transferred' means the original deposit carried over with no new charge (§1.1). */
  depositStatus: string;
  googleCalendarEventId: string | null;
  smsHistory: SmsMessage[];
  rescheduledFromId: string | null; // UUID of the booking this one was rescheduled from (§3.2)
  rescheduleLog: RescheduleLogEntry[];
};

/**
 * Minimal placeholder. The leads feature is PRD-scoped, not in the reschedule
 * spec; refine shape when the leads feature is actually built.
 */
export type Lead = {
  id: string; // UUID
  phone: string; // E.164
  customerName: string | null;
  serviceDescription: string | null;
  /** Unbounded for now; e.g. 'new' | 'contacted' | 'booked'. */
  status: string;
  /** ISO 8601 timestamp. */
  createdAt: IsoString;
};

export type ConversationStateValue =
  | 'offering_slots'
  | 'awaiting_slot_choice'
  | 'awaiting_confirmation_code'
  | 'completed'
  | 'escalated';

export type OfferedSlot = {
  optionNumber: 1 | 2 | 3;
  /** ISO 8601 datetime. */
  startTime: IsoString;
  /** ISO 8601 datetime. */
  endTime: IsoString;
};

export type ConversationState = {
  id: string; // UUID
  /** Customer phone, E.164. */
  phone: string;
  userId: string; // UUID
  /** UUID of the booking being rescheduled, null when not applicable. */
  bookingId: string | null;
  state: ConversationStateValue;
  offeredSlots: OfferedSlot[] | null;
  selectedSlot: OfferedSlot | null;
  escalationReason: string | null;
  /** ISO 8601 timestamp. */
  createdAt: IsoString;
  /** ISO 8601 timestamp. */
  updatedAt: IsoString;
  /** ISO 8601 timestamp, null until `state === 'completed'`. */
  completedAt: IsoString | null;
  /** T15: pending confirm-code handshake — sha256 of the issued code (the
   *  plaintext is never persisted), null when no code is outstanding. */
  confirmationCodeHash: string | null;
  /** T15: expiry of the pending confirmation code (issued with a 10-minute TTL). */
  confirmationCodeExpiresAt: IsoString | null;
  /** T15: consecutive wrong-code replies against the current issued code. */
  confirmationAttempts: number;
};

/** Twilio inbound-SMS webhook body (application/x-www-form-urlencoded), §2.1. */
export type TwilioInboundSmsPayload = {
  From: string; // customer phone, E.164
  To: string; // tradesperson's Twilio number, E.164
  Body: string;
  MessageSid: string;
  AccountSid: string;
  // Twilio appends more fields (FromCity, FromState, SmsSid, ...).
  [key: string]: string | undefined;
};

/** Twilio Message StatusCallback payload (outbound delivery reports). */
export type TwilioStatusCallbackPayload = {
  MessageSid: string;
  /** e.g. 'sent' | 'delivered' | 'failed' | 'undelivered'. */
  MessageStatus: string;
  ErrorCode: string | null;
  ErrorMessage: string | null;
  To: string;
  From: string;
  AccountSid: string;
  [key: string]: string | null | undefined;
};

export type Intent =
  | 'reschedule'
  | 'confirm'
  | 'help'
  | 'slot-choice'
  | 'unknown'
  | 'no-matching-booking';

export type IntentResult = {
  intent: Intent;
  /** 0..1; confidence < 0.7 escalates as ambiguous_intent (§1.3). */
  confidence: number;
};

/** §2.7 — calendar availability query result item. */
export type AvailableSlot = {
  /** ISO 8601 datetime. */
  startTime: Date;
  /** ISO 8601 datetime. */
  endTime: Date;
};

export type CalendarQueryError = {
  /** e.g. 'calendar_api_error'. */
  type: string;
  message: string;
};

/** §2.7 — never thrown; API failure is reported in `errors`. */
export type GetAvailableSlotsResult = {
  /** Sorted by startTime ascending; up to 20 slots (§2.7 logic step 6). */
  slots: AvailableSlot[];
  /** Non-empty only when the calendar query failed. */
  errors: CalendarQueryError[];
};

/** §2.8 — error shape for all internal functions. */
export type ApiError = {
  /** Known values: 'not_found' | 'bad_request' | 'calendar_api_error' | 'sms_send_error'. */
  type: string;
  message: string;
  /** Machine-readable error code for logging/alerting; null when none. */
  code: string | null;
  details?: Record<string, unknown>;
};

export type EscalationType =
  | 'ambiguous_intent'
  | 'no_availability'
  | 'calendar_api_failure'
  | 'sms_delivery_failure'
  | 'processing_error'
  | 'customer_escalation';

export type EscalationStatus = 'pending' | 'resolved';

export type Escalation = {
  id: string; // UUID
  type: EscalationType;
  customerPhone: string;
  content: string | null;
  status: EscalationStatus;
  /** ISO 8601 timestamp. */
  createdAt: IsoString;
  /** ISO 8601 timestamp; null until resolved. */
  resolvedAt: IsoString | null;
};

/** §2.9 — GET /api/dashboard/escalations response body. */
export type EscalationListResponse = {
  escalations: Escalation[];
  total: number;
  page: number;
  pageSize: number;
};

/** §2.9 — GET /api/dashboard/bookings/:bookingId/reschedule-history response body. */
export type RescheduleHistoryResponse = {
  bookingId: string;
  rescheduleLog: RescheduleLogEntry[];
};

// ── Auth (dashboard JWT) ───────────────────────────────────────────────────
// §PRD "JWT auth for tradesperson dashboard". Credentials are email + password;
// the API issues a signed JWT (sub = tradesperson id), the web app stores it in
// the `ts_session` cookie. Auth endpoints live under /api/auth.

/** Tradesperson identity returned after login/register; lean vs the full
 *  `User` profile (phone, calendar, hours, sms settings) from fixtures.
 *  phoneNumber is carried by the rl_tradespeople row (nullable column). */
export type AuthUser = {
  id: string; // UUID of the tradesperson row
  email: string;
  displayName: string;
  /** E.164-ish phone (e.g. "+15551234567"), null when unset. Added with
   *  PATCH /api/auth/profile (T7); /me and login/register return it too. */
  phoneNumber: string | null;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type RegisterRequest = {
  displayName: string;
  email: string;
  password: string;
};

/** Success body for POST /api/auth/login and POST /api/auth/register. */
export type AuthResponse = {
  token: string; // signed JWT; web stores it in ts_session cookie
  user: AuthUser;
};

/** Error bodies returned by the auth routes. */
export type AuthError =
  | 'invalid_body'
  | 'invalid_credentials'
  | 'email_taken'
  | 'missing_token'
  | 'invalid_token'
  | 'server_not_configured';

export type AuthErrorResponse = {
  error: AuthError;
};

// ── Google OAuth (real wiring; replaces GOOGLE_REFRESH_TOKEN_<userId> env) ──
// The API stores Google OAuth tokens per tradesperson (rl_google_credentials)
// and the web settings page drives the connect/disconnect flow via
// /api/auth/google/*. AuthUser.id is the rl_tradespeople row id (creds.user_id).

export type GoogleCredentials = {
  /** rl_tradespeople.id of the owner. */
  userId: string;
  accessToken: string;
  /** Present because the consent flow uses access_type=offline+prompt=consent. */
  refreshToken: string;
  /** ISO 8601 datetime; null when the token never expires / unknown. */
  tokenExpiry: IsoString | null;
  /** Granted Google scope string; null when unrecorded. */
  scope: string | null;
  /** Calendar identifier (e.g. 'primary') used by the pipeline. */
  calendarId: string | null;
};

/** GET /api/auth/google/status response body. */
export type GoogleConnectionStatus = {
  connected: boolean;
  calendarId: string | null;
};

/** GET /api/auth/google/start response body: goto `url` to begin consent. */
export type GoogleAuthStartResponse = {
  url: string;
};

export type GoogleOAuthError =
  | 'invalid_body'
  | 'missing_token'
  | 'invalid_token'
  | 'invalid_state'
  | 'missing_google_config'
  | 'google_denied'
  | 'exchange_failed'
  | 'server_not_configured';

export type GoogleOAuthErrorResponse = {
  error: GoogleOAuthError;
};

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
  aiCostByDay: SeriesPointDto[];           // 30d, $ (org-scoped — rl_ai_usage.organization_id, T9)
  topServices: TopServiceDto[];            // top 5 by appointment count
  technicianLoad: TechnicianLoadDto[];     // top 5 by appointment count
};

export type DashboardApiErrorResponse = {
  error:
    | 'no_organization'
    | 'invalid_query'
    | 'server_error'
    | 'invalid_body'
    | 'conversation_not_found'
    | 'no_suggestion';
};

/** Success body for POST /api/dashboard/inbox/:conversationId/reply and
 *  POST /api/dashboard/inbox/:conversationId/approve (T10). */
export interface InboxActionResponse {
  ok: true;
}

/** Automation toggle values, persisted per org in
 *  rl_organizations.settings.automation (T11). */
export interface AutomationSettings {
  aiFrontDesk: boolean;
  reviewRequests: boolean;
  depositRequired: boolean;
}

/** GET/PATCH /api/dashboard/settings/automation response body (T11). */
export interface DashboardAutomationResponse {
  automation: AutomationSettings;
}
