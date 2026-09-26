# Decision record — SMS-only cleanup

Date: 2026-09-25
Status: accepted

Context: the product is SMS only. A half-finished second channel (WhatsApp) and
a half-finished SMS retry engine (delivery-failure → WhatsApp fallback) were
built on top of the SMS pipeline. Both were abandoned mid-way and the working
tree is mid-refactor.

## 1. Decisions

### D1 — No WhatsApp surface remains
The WhatsApp channel is removed from the API, the shared package, the env
template, the deployment config, and the dashboard. There is no partial
WhatsApp support left: no env var, no type member, no route branch, no UI label.

### D2 — No delivery-failure retry, this round
The Twilio StatusCallback records `failed` / `undelivered` as `failed` and
stops. There is no retry, no fallback channel, and no new delivery status.
The previously half-built retry engine is deleted rather than finished, because
it was unsound in ways that would need redesign rather than repair:
the original row was marked `retried` before the replacement was inserted
(so a crash in between silently lost the message), there was no attempt/parent
link between the original and the retry, the declared max-attempt cap was
never read (unbounded retry chain), the "already claimed" check was a
non-atomic read-then-write (two concurrent callbacks would each send), the
success path marked the wrong row as sent, the escalation types it wrote are
ones the live DB CHECK rejects, the terminal-status lists disagreed with the
ledger's own write-once guard, and its consent check only ran when a
`customerId` happened to be set — fail-open for every staff and manual send.
A rebuild is tracked as follow-up F6 in `PLAN.md` and must be a new module
with a single atomic claim and a real attempt linkage.

### D3 — The ledger keeps its seven statuses
`rl_outbound_messages` keeps `queued | sent | delivered | failed | retried |
escalated | blocked_optin` in the migration CHECK, in `OutboundStatus`, and in
the dashboard label maps. Nothing writes the last three today; historical rows
already contain them, so narrowing the CHECK would break rendering old history.
`blocked_optin` is deliberately not terminal: it is a pre-delivery consent
refusal, so a later real delivery report for the same SID is still recorded.

### D4 — Consent lives in one place
`apps/api/src/services/consent-service.ts` is the only authority for
`sms_opted_in` / `sms_opted_in_at`. It honors `CUSTOMERS_TABLE`, sets the flag
and the timestamp together, and is idempotent. The outbound ledger no longer
exports `hasSmsOptIn`. A valid inbound customer SMS records the opt-in before
classification, so a customer who has replied has a consent record and the
outbound gate passes for them.

### D5 — Migration 014 is edited in place, with a warning header
`014-whatsapp-fallback.sql` keeps its filename (it is referenced by path in
`db-migrate.mjs` and `schema.sql`) and its SMS-only body. Its header now warns
that an environment which applied the pre-cleanup 014 needs a future 015 to
replace the old constraints. 015 is not part of this change.

## 2. What is explicitly NOT decided here

- Whether a failed SMS should ever be retried, and under what consent and
  attempt-linking rules. See follow-up F6.
- The data-model problems listed as F1–F5 and F8–F9 in `PLAN.md`
  (cross-tenant escalation injection, tenant-less conversation states, zero
  RLS policies, dual outbound ledgers, the staff phone split, and the missing
  015). Each needs its own decision.
- Any change to the seven-value `EscalationType` set. It must match the live
  DB CHECK; see D3-adjacent note in `PLAN.md` §1.6.
