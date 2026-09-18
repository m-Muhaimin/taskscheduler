import './env.js';
import { complete, dequeue, fail } from '../services/queue-service.js';
import type { QueueJob } from '../services/queue-service.js';
import { processInboundSms } from './process-inbound-sms.js';

/**
 * Worker process (build-sequence.md Step 4): polls dequeue() in a loop,
 * dispatches on job.type, completes or fails. Never crashes the loop on a
 * single bad job — that job is marked failed and processing continues.
 */
const WORKER_ID = `worker-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS ?? 1000);

const handlers: Record<string, (job: QueueJob) => Promise<void>> = {
  inbound_sms: processInboundSms,
};

let running = true;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function tick(): Promise<void> {
  const job = await dequeue(WORKER_ID);
  if (!job) {
    return;
  }
  const handler = handlers[job.type];
  if (!handler) {
    await fail(job.id, new Error(`no handler for job type "${job.type}"`));
    return;
  }
  try {
    await handler(job);
    await complete(job.id);
    console.log('[worker] completed job', JSON.stringify({ id: job.id, type: job.type }));
  } catch (err) {
    await fail(job.id, err);
  }
}

async function main(): Promise<void> {
  console.log(`[worker] started ${WORKER_ID} (poll ${POLL_INTERVAL_MS}ms)`);
  while (running) {
    try {
      await tick();
    } catch (err) {
      // Pool/config-level errors: log and keep polling; do not die on a blip.
      console.error('[worker] tick error', err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log('[worker] stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
