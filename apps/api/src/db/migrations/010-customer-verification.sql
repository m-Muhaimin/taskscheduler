-- Migration 010: OTP device verification columns on rl_customers (T14).
-- First-contact phone verification: a new customer must prove control of the
-- From number once (reply with a 6-digit code) before the worker classifies
-- or responds. phone_verified_at null = not verified yet.
--
-- Idempotent (add column if not exists): local-db.mjs re-applies all
-- migrations on every boot. No data backfill — all existing rows start
-- unverified (phone_verified_at null) and are asked to verify on their next
-- text; acceptable for this stage.
--
-- RLS untouched: rl_customers is already deny-by-default (migration 007); the
-- API connects as the service/owner role, not anon/authenticated.

alter table public.rl_customers
  add column if not exists phone_verified_at timestamptz,        -- null = not verified
  add column if not exists verification_code text,               -- pending code (null = none)
  add column if not exists verification_code_expires_at timestamptz,
  add column if not exists verification_attempts int not null default 0;