# CLAUDE.md

> ⚠️ **SPECULATIVE — no code exists yet.** Everything below is inferred
> from `docs/prd-scheduling-assistant.md` and
> `docs/prd-ai-scheduling-dispatch-assistant.md`, not detected from a
> real codebase. Treat every line as a proposal to confirm or overwrite
> once actual code lands — nothing here is a "convention," since there's
> nothing yet to be conventional. Re-run the CLAUDE.md scan prompt once
> `package.json` and source files exist.

## What this project is

AI scheduling/dispatch assistant for solo tradespeople (plumbers,
electricians, HVAC). Auto-confirms bookings via SMS, parses
natural-language reschedule replies, and turns missed calls into
booked jobs.

## ⚠️ Unresolved before build starts

- **Two PRD drafts conflict on payment processor**: one specifies
  Stripe, the other Paddle. Pick one and delete/merge the stale draft
  before scaffolding — do not build with both in the repo.
- No repo scaffold, no chosen package manager, no CI config yet.

## Intended tech stack (per PRD — not yet installed)

- Frontend: Next.js (mobile-first PWA), Tailwind CSS + shadcn/ui
- Backend: Express.js / Node
- SMS/Voice: Twilio
- Calendar: Google Calendar API
- Payments: **Paddle** (per latest PRD draft — confirm before building)
- Auth: JWT
- AI: LLM-based intent parsing for reschedule replies
- DB: Postgres (via Supabase, per earlier planning — not in PRD, confirm)

No versions are pinned anywhere yet. First real commit should lock
exact versions in `package.json` and this file should be regenerated
against it.

## Commands

Not yet defined — no `package.json` exists. Placeholder assumption
(Next.js default): `dev` / `build` / `test` / `lint`. Confirm once
scaffolded.

## Architecture (intended, not built)

- `docs/` — PRDs (currently the only real content in the repo)
- `app/` or `src/` — Next.js frontend (not created)
- `server/` — Express backend (not created)
- No data layer exists yet; PRD references tables for tradespeople,
  customers, jobs, bookings, sms_logs, calendar_syncs but no schema
  or migrations exist.

## Code conventions

None detectable — empty repo. Do not invent style rules; adopt
whatever the first real code establishes and regenerate this section
then.

## Hard rules (carried forward from prior planning, to enforce once code exists)

- Never send an SMS without a logged consent record
- Never auto-confirm a reschedule without an explicit customer reply
- Never touch payment code (Paddle/Stripe — TBD) or Twilio webhook
  signature verification without explicit sign-off
- Use shadcn/ui components instead of hand-rolled UI primitives once
  frontend work begins

## Gotchas a new engineer would hit in week 1

- There is currently no code — the biggest "gotcha" is discovering
  that despite two PRDs, nothing has been built
- The two PRD drafts contradict each other on payment provider; don't
  assume either is final without asking
