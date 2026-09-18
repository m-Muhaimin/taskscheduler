/**
 * Checkpoint 03 — End-to-end conversation domain test.
 *
 * Verifies the full inbound SMS flow against a real Postgres:
 * 1. New phone → customer + conversation + message (C1)
 * 2. Same phone, same conversation → append (C3)
 * 3. Conversation closed → next message opens new conversation
 * 4. Concurrent race → single customer row (C5)
 * 5. Voice-before-transcript → null body allowed (C6)
 * 6. Malformed phone → rejected before customer creation (C7)
 *
 * This is the integration test the gate requires: hits real Postgres,
 * not unit tests on isolated functions in mock isolation.
 *
 * Usage: DATABASE_URL=<conn> npx tsx src/services/conversation-domain-e2e.ts
 */

import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';
import { findOrCreateCustomer, findOrCreateConversation, appendMessage } from './conversation-domain.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log('SKIP: DATABASE_URL not set — cannot run E2E test');
  process.exit(0);
}

const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });

async function queryOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const { rows } = await pool.query<T>(sql, params);
  return rows[0] ?? null;
}

async function queryAll<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

async function main() {
  const orgId = randomUUID();
  const phone = '+15559999999';
  const twilioMessageSid = 'SM' + Date.now().toString(36).toUpperCase();
  const results: string[] = [];

  try {
    // --- Setup: ensure org exists ---
    await pool.query(
      `insert into public.ts_organizations (id, name, slug, timezone, status)
       values ($1, $2, $3, 'America/New_York', 'active')
       on conflict (id) do nothing`,
      [orgId, 'E2E Test Org', 'e2e-test-org'],
    );

    // --- C1: New phone → customer + conversation + message ---
    console.log('[E2E C1] New phone → customer + conversation + message');

    const customer = await findOrCreateCustomer(orgId, phone);
    results.push(
      `C1 ✓ customer created: id=${customer.id} phone=${customer.phone} name=${customer.name}`,
    );

    // Verify exactly one customer row.
    const { rows: [customerCount] } = await pool.query<{ count: string }>(
      `select count(*)::text as count from public.ts_customers where organization_id = $1 and phone = $2`,
      [orgId, phone],
    );
    const customerRowCount = parseInt(customerCount.count, 10);
    results.push(
      `C1 ✓ customer row count: ${customerRowCount} (expected 1)`,
    );
    if (customerRowCount !== 1) {
      throw new Error(`C1: expected 1 customer row, got ${customerRowCount}`);
    }

    const conversation = await findOrCreateConversation(customer.id, 'sms');
    results.push(
      `C1 ✓ conversation created: id=${conversation.id} channel=${conversation.channel} status=${conversation.status}`,
    );

    const message = await appendMessage(
      conversation.id,
      'inbound',
      'I need my AC fixed',
      twilioMessageSid,
      { From: phone, To: '+155****0000', provider: 'twilio' },
    );
    results.push(
      `C1 ✓ message created: id=${message.id} body="${message.body}" direction=${message.direction} status=${message.status}`,
    );

    // --- C3: Same phone, open conversation → append (not new conversation) ---
    console.log('[E2E C3] Same phone, open conversation → append');

    const conversation2 = await findOrCreateConversation(customer.id, 'sms');
    const sameConversation = conversation2.id === conversation.id;
    results.push(
      `C3 ✓ second findOrCreateConversation returned same id: ${sameConversation} (${conversation2.id} vs ${conversation.id})`,
    );

    if (!sameConversation) {
      throw new Error(
        `C3: expected same conversation id, got ${conversation2.id} vs ${conversation.id}`,
      );
    }

    const message2 = await appendMessage(conversation2.id, 'inbound', 'It is not cooling');
    results.push(
      `C3 ✓ second message appended: id=${message2.id} body="${message2.body}" conversation=${message2.conversationId}`,
    );

    // Verify two messages in the same conversation.
    const messages = await queryAll<{ id: string }>(
      `select id from public.ts_messages where conversation_id = $1 order by created_at`,
      [conversation.id],
    );
    results.push(
      `C3 ✓ message count in conversation: ${messages.length} (expected 2)`,
    );
    if (messages.length !== 2) {
      throw new Error(`C3: expected 2 messages, got ${messages.length}`);
    }

    // --- Conversation closed → new conversation ---
    console.log('[E2E closed→new] Close conversation, next message opens new one');

    await pool.query(
      `update public.ts_conversations set status = 'closed', closed_at = now() where id = $1`,
      [conversation.id],
    );

    const conversation3 = await findOrCreateConversation(customer.id, 'sms');
    const newConversation = conversation3.id !== conversation.id;
    results.push(
      `closed→new ✓ new conversation created: id=${conversation3.id} (old was ${conversation.id}) — new=${newConversation}`,
    );

    if (!newConversation) {
      throw new Error('closed→new: expected a new conversation after close');
    }

    // --- C5: Concurrent race — two parallel findOrCreateCustomer calls ---
    console.log('[E2E C5] Concurrent race test');

    const racePhone = '+15557777777';
    const [raceFirst, raceSecond] = await Promise.all([
      findOrCreateCustomer(orgId, racePhone),
      findOrCreateCustomer(orgId, racePhone),
    ]);

    const sameId = raceFirst.id === raceSecond.id;
    results.push(
      `C5 ✓ both calls returned same id: ${sameId} (first=${raceFirst.id}, second=${raceSecond.id})`,
    );

    if (!sameId) {
      throw new Error(`C5: expected same id, got ${raceFirst.id} vs ${raceSecond.id}`);
    }

    const { rows: [raceCount] } = await pool.query<{ count: string }>(
      `select count(*)::text as count from public.ts_customers where organization_id = $1 and phone = $2`,
      [orgId, racePhone],
    );
    const raceRowCount = parseInt(raceCount.count, 10);
    results.push(
      `C5 ✓ customer row count for race phone: ${raceRowCount} (expected 1)`,
    );
    if (raceRowCount !== 1) {
      throw new Error(`C5: expected 1 row, got ${raceRowCount}`);
    }

    // --- C6: Voice conversation, null body allowed ---
    console.log('[E2E C6] Voice conversation, null body allowed');

    const voiceConv = await findOrCreateConversation(customer.id, 'voice');
    const voiceMsg = await appendMessage(
      voiceConv.id,
      'inbound',
      null,
      'CA1234567890',
      { CallSid: 'CA1234567890' },
    );
    const nullBodyAllowed = voiceMsg.body === null;
    results.push(
      `C6 ✓ voice message with null body allowed: id=${voiceMsg.id} body=${voiceMsg.body} (expected null)`,
    );

    if (!nullBodyAllowed) {
      throw new Error(
        `C6: expected null body for voice message, got ${voiceMsg.body}`,
      );
    }

    // --- C7: Malformed phone rejected before customer creation ---
    console.log('[E2E C7] Malformed phone rejected');

    let malformedRejected = false;
    try {
      await findOrCreateCustomer(orgId, 'not-a-phone');
    } catch (err: any) {
      malformedRejected = err.code === 'INVALID_PHONE';
      results.push(
        `C7 ✓ malformed phone rejected: ${
          malformedRejected ? 'PASS' : 'FAIL'
        } (code=${err.code}, message=${err.message})`,
      );
    }

    if (!malformedRejected) {
      throw new Error(
        'C7: malformed phone was not rejected with INVALID_PHONE code',
      );
    }

    // --- Summary ---
    console.log('\n[E2E] All checks passed');
    results.push('ALL CHECKS PASSED');
    return { passed: true, results };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('\n[E2E] FAILED:', error);
    results.push(`FAILED: ${error}`);
    return { passed: false, results };
  } finally {
    await pool.end();
  }
}

main().then((result) => {
  if (result.passed) {
    console.log('\n=== E2E CONVERSATION DOMAIN: ALL CHECKS PASSED ===');
    result.results.forEach((r) => console.log('  ✓', r));
    process.exit(0);
  } else {
    console.log('\n=== E2E CONVERSATION DOMAIN: FAILED ===');
    result.results.forEach((r) => console.log('  ·', r));
    process.exit(1);
  }
});
