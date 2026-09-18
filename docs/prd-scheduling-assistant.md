# PRD: AI-Powered Scheduling and Dispatch Assistant

## Problem Statement
Solo and micro-crew tradespeople (plumbers, electricians, HVAC, handymen, locksmiths) lose revenue and waste time due to:
- Manual booking confirmation via phone/SMS leading to no-shows
- Inability to handle reschedule requests in real-time while on jobs
- Missed calls from potential customers going unanswered, losing leads
- No dedicated dispatch staff causing scheduling conflicts and admin overload

## Success Metrics
- Reduce no-shows by 30% via automated SMS confirmation
- Increase booking conversion from missed calls by 25% via auto-text follow-up
- Decrease admin time spent on scheduling/rescheduling by 50%
- Achieve 90% accuracy in parsing natural-language reschedule requests
- Maintain <2% error rate in SMS/calendar sync operations

## User Stories & Acceptance Criteria

### 1. Auto-confirm bookings via SMS
**As a tradesperson, I want bookings to be automatically confirmed via SMS so I reduce no-shows without manual follow-up.**
- AC1: When a new booking is created in Google Calendar, an SMS is sent to the customer within 1 minute
- AC2: SMS includes booking details (date, time, service, tradesperson name) and clear CTA to confirm/reschedule
- AC3: If customer replies "CONFIRM", booking status updates to confirmed in calendar
- AC4: If no response within 2 hours, a reminder SMS is sent
- AC5: System logs SMS delivery status and customer responses for audit

### 2. Handle reschedule requests via natural-language SMS
**As a tradesperson, I want customers to reschedule via simple text replies so I don't need to interrupt work for phone calls.**
- AC1: When customer replies to booking SMS with reschedule intent (e.g., "Can we move to tomorrow?"), AI parses request
- AC2: AI extracts new preferred date/time window and checks tradesperson's calendar availability
- AC3: If slot available, AI proposes 2-3 options via SMS; customer selects by replying with option number
- AC4: If no availability, AI suggests nearest alternatives and escalates to tradesperson for manual handling
- AC5: All reschedule interactions are logged in booking history with AI confidence score

### 3. Convert missed calls to booking opportunities
**As a tradesperson, I want missed calls to trigger auto-text follow-up so I capture leads I'd otherwise miss.**
- AC1: When an incoming call is missed (after 3 rings), system detects via Twilio webhook
- AC2: Within 30 seconds, an SMS is sent to caller: "Sorry I missed your call! I'm [Name], a [trade]. Text your service need & I'll reply ASAP."
- AC3: If caller replies with service request, AI logs as new lead and triggers booking flow
- AC4: If no reply within 1 hour, no further action (avoid spam)
- AC5: Missed call + auto-text events are tracked in dashboard for ROI measurement

## Scope: v1 vs Future

### Ships in v1
- Core SMS confirmation/reschedule flow for new bookings
- Missed call auto-text trigger with basic lead capture
- Google Calendar sync (two-way for availability checks)
- Twilio integration for SMS sending/receiving
- JWT auth for tradesperson dashboard
- Paddle integration for collecting deposits at booking time
- Simple intent parsing (rule-based + LLM fallback for reschedule)

### LLM Layer (Checkpoint 01 — implemented)

The `@tradescheduler/ai` package provides a provider-agnostic LLM layer:

- **Interface**: `AIProvider` with `generateStructured()`, `generateText()`, `getUsage()`.
- **Structured schema**: 6 intents (`new_booking`, `reschedule`, `cancel`, `question`, `emergency`, `unknown`) + structured fields (service, customer_name, preferred_date, preferred_time_start, preferred_time_end, urgency, missing_information, confidence).
- **OpenAI adapter**: first wired provider (gpt-4o-mini), structured output via `response_format: { type: "json_schema" }`, usage tracking, retry logic, error mapping.
- **Rule-based fallback**: wraps existing `intent-service.ts` `parseIntent()` — explicit fallback, not deleted or replaced.
- **Fallback policy**: LLM first → if fails/low confidence → rule-based parser → if both unknown → escalate, never guess. Superset guarantee: rule-based high-confidence intent (≥0.9) wins over LLM.
- **Cost tracking**: `ai_usage` table records per-call token usage + estimated USD cost. Analytics dashboard (P0.9) reads from this table.

New env vars: `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`.

### Planned work (not started)

- **Checkpoint 02**: Tenant model — replace single-tradesperson identity with organizations + organization_members (OWNER/STAFF/TECHNICIAN), migration path from ts_tradespeople.
- **Checkpoint 03**: Customer + Conversation domain — customers, customer_addresses, conversations, messages tables; findOrCreateCustomer/Conversation/Message services; process-inbound-sms.ts wiring.
- **Checkpoint 04**: Booking / Appointment domain — appointments table, concrete BookingLookupFn, wire into process-inbound-sms.ts.
- **Checkpoint 05**: Real Scheduling Engine — SchedulingEngine service on top of calendar-service.ts.
- **Checkpoint 06**: AI Booking Agent — wire LLM + conversation domain + scheduling engine into conversational booking.
- **Checkpoint 07**: Production communications hardening — idempotency, rate limiting, retry/dead-letter, delivery tracking, CVE audit.
- **Checkpoint 08**: Replace dashboard fixtures with real API-backed data.
- **Checkpoint 09**: Technicians + Dispatch + Job Lifecycle.
- **Checkpoint 10**: Revenue Loop — missed-call recovery, follow-up automation, analytics.
- Admin settings: SMS templates, business hours, trade type

### Not in v1 (v2+)
- AI-powered dynamic pricing based on demand/time
- Recurring booking/maintenance plan management
- Multi-tradesperson team scheduling with skill matching
- Advanced analytics (revenue forecasting, customer lifetime value)
- Voice call handling (beyond missed-call SMS)
- Integration with other calendars (Outlook, Apple Calendar)
- In-app chat for customer tradesperson communication
- Payment processing beyond deposits (final invoices via Paddle)

## Data Model Changes

### Existing (extends User/Booking)
```javascript
// User model (tradesperson)
{
  id: string,
  phoneNumber: string, // Twilio-verified
  businessName: string,
  tradeType: enum, // plumber, electrician, etc.
  googleCalendarId: string, // linked calendar
  paddleCustomerId: string,
  smsSettings: {
    confirmationTemplate: string,
    rescheduleTemplate: string,
    missedCallTemplate: string,
    businessHours: { start: string, end: string, timezone: string }
  }
}

// Booking model
{
  id: string,
  userId: string,
  customerPhone: string,
  customerName: string,
  serviceDescription: string,
  startTime: datetime,
  endTime: datetime,
  status: enum, // pending, confirmed, rescheduled, completed, cancelled
  depositAmount: number, // via Paddle
  depositStatus: enum, // pending, paid, failed
  smsHistory: [{ // array of SMS interactions
    direction: 'inbound'|'outbound',
    content: string,
    timestamp: datetime,
    twilioMessageId: string,
    aiIntent: string, // parsed intent for inbound
    confidence: number
  }],
  googleCalendarEventId: string
}

// New: Lead model (from missed calls)
{
  id: string,
  userId: string,
  customerPhone: string,
  firstContact: datetime, // missed call timestamp
  serviceRequest: string, // from SMS reply if any
  status: enum, // new, contacted, quoted, booked, lost
  lastContact: datetime
}
```

## Edge Cases & Failure States

### SMS Delivery Failures
- **Problem**: Twilio returns undelivered/spam flagged
- **Handling**: Retry once with alternate template; if fails twice, notify tradesperson via dashboard alert and fallback to email (if on file)

### Customer Ambiguous Replies
- **Problem**: Customer replies "Maybe later?" or sends media
- **Handling**: AI confidence <70% triggers escalation to tradesperson; SMS: "I didn't catch that. Reply 'HELP' for options or call me."

### Calendar Sync Conflicts
- **Problem**: Double-booking due to external calendar changes
- **Handling**: Pre-booking availability check; if conflict detected post-booking, SMS both parties: "Conflict detected. Let me find a new time."

### Missed Call Spam Prevention
- **Problem**: Same number calling repeatedly (telemarketer)
- **Handling**: Rate-limit auto-text to max 2 per number per day; block after 3 missed calls without reply

### LLM Parsing Errors
- **Problem**: AI misinterprets reschedule request (e.g., "next Friday" vs "this Friday")
- **Handling**: Always show parsed date/time in confirmation SMS for customer to correct; log errors for model retraining

### Offline/Failure Recovery
- **Problem**: Backend downtime during booking flow
- **Handling**: Queue SMS/webhook events with retry (max 5 attempts); dead-letter queue triggers tradesperson alert after 1 hour

## Open Questions for You

1. **SMS Cost Tolerance**: What's the max acceptable cost per booking confirmation/reschedule attempt via Twilio? (Current estimate: $0.0075/SMS)
2. **AI Provider Preference**: Open-source LLM (Llama 3) vs hosted (OpenRouter) for intent parsing? Latency vs cost tradeoff.
3. **Booking Lead Time**: How far in advance do customers typically book? Affects calendar sync frequency and availability caching.
4. **Deposit Flow**: Should Paddle deposit be collected before or after SMS confirmation? Before reduces no-shows but may drop conversion.
5. **International Support**: Targeting US only initially? Twilio pricing and SMS compliance vary by country.
6. **Emergency Override**: Should tradespeople be able to pause auto-SMS during emergencies? (e.g., "STOP ALL SMS for 2 hours")
7. **Metrics Dashboard**: Which 3 metrics are most vital for v1 launch tracking beyond the success metrics above?

---
*PRD Version: 1.0*
*Created: 2026-09-17*
*Reference: docs/prd-scheduling-assistant.md*
