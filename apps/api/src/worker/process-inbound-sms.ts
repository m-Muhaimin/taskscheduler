import type { QueueJob } from '../services/queue-service.js';

/**
 * Handler for `type = 'inbound_sms'` (build-sequence.md Step 4).
 * Stub for now: logs the payload and completes. Real dispatch — intent
 * parsing, reschedule-flow entry, escalation — lands in Step 6.
 */
export async function processInboundSms(job: QueueJob): Promise<void> {
  console.log('[worker] inbound_sms', JSON.stringify(job.payload));
}
