import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../services/verification-service.js';

/**
 * Worker wiring tests for processInboundSms (CP03 spec H):
 * customer + conversation + message layer runs in front of intent dispatch.
 */
const m = vi.hoisted(() => ({
  findOrCreateCustomer: vi.fn(),
  findOrCreateConversation: vi.fn(),
  appendMessage: vi.fn(),
  resolveOrganizationIdByTwilioNumber: vi.fn(),
  createEscalation: vi.fn(),
  classifyStep: vi.fn(),
  createProvider: vi.fn(),
  recordAiUsage: vi.fn(),
  getConversationByPhone: vi.fn(),
  sendSms: vi.fn(),
  initiateRescheduleFlow: vi.fn(),
  processSlotChoice: vi.fn(),
  confirmReschedule: vi.fn(),
  findBookingById: vi.fn(),
  findBookingByPhone: vi.fn(),
  findUserProfile: vi.fn(),
  updateBookingTimes: vi.fn(),
  findUserBookingsInWindow: vi.fn(),
  createConversation: vi.fn(),
  poolQuery: vi.fn(), // T14: the worker's own verification-gate pg pool
}));

vi.mock('pg', () => ({ Pool: class MockPool { query = m.poolQuery; } }));

vi.mock('../services/conversation-domain.js', () => ({
  findOrCreateCustomer: m.findOrCreateCustomer,
  findOrCreateConversation: m.findOrCreateConversation,
  appendMessage: m.appendMessage,
}));
vi.mock('../services/organization-service.js', () => ({
  resolveOrganizationIdByTwilioNumber: m.resolveOrganizationIdByTwilioNumber,
}));
vi.mock('../services/escalation-service.js', () => ({
  createEscalation: m.createEscalation,
}));
vi.mock('@tradescheduler/ai', () => ({
  classifyStep: m.classifyStep,
  createProvider: m.createProvider,
}));
vi.mock('../services/ai-usage-service.js', () => ({
  recordAiUsage: m.recordAiUsage,
}));
vi.mock('../services/conversation-service.js', () => ({
  createConversation: m.createConversation,
  getConversationByPhone: m.getConversationByPhone,
}));
vi.mock('../services/booking-service.js', () => ({
  findBookingById: m.findBookingById,
  findBookingByPhone: m.findBookingByPhone,
  findUserProfile: m.findUserProfile,
  updateBookingTimes: m.updateBookingTimes,
  findUserBookingsInWindow: m.findUserBookingsInWindow,
}));
vi.mock('../services/sms-service.js', () => ({
  sendSms: m.sendSms,
}));
vi.mock('../services/reschedule-service.js', () => ({
  initiateRescheduleFlow: m.initiateRescheduleFlow,
  processSlotChoice: m.processSlotChoice,
  confirmReschedule: m.confirmReschedule,
}));

const BOOKING = {
  id: 'apt-1',
  userId: 'user-1',
  customerPhone: '+15551234567',
  customerName: 'Sam',
  serviceDescription: 'drain',
  startTime: '2026-09-18T14:00:00.000Z',
  endTime: '2026-09-18T15:00:00.000Z',
  status: 'pending',
  depositStatus: 'paid',
  googleCalendarEventId: null,
  smsHistory: [],
  rescheduledFromId: null,
  rescheduleLog: [],
};

async function loadWorker() {
  return await import('./process-inbound-sms.js');
}

function job(payload: Record<string, unknown>): import('../services/queue-service.js').QueueJob {
  return {
    id: 'job-1',
    type: 'inbound_sms',
    payload,
    status: 'pending',
    attempts: 0,
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  for (const fn of Object.values(m)) fn.mockReset();
  m.poolQuery.mockResolvedValue({ rows: [] });
  // Default customer is VERIFIED so pre-T14 tests exercise the steady-state
  // path (gate skipped entirely). T14 gate tests override with unverified rows.
  m.findOrCreateCustomer.mockResolvedValue({
    id: 'cust-1',
    organizationId: 'org-1',
    name: null,
    phone: '+15551234567',
    email: null,
    phoneVerifiedAt: '2026-09-01T00:00:00.000Z',
    verificationCode: null,
    verificationCodeExpiresAt: null,
    verificationAttempts: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  });
  m.findOrCreateConversation.mockResolvedValue({ id: 'conv-1', status: 'open' });
  m.appendMessage.mockResolvedValue({ id: 'msg-1' });
  m.resolveOrganizationIdByTwilioNumber.mockResolvedValue('org-1');
  m.classifyStep.mockResolvedValue({
    intentResult: { intent: 'unknown', confidence: 0 },
    aiUsage: null,
    source: 'escalation',
    requestId: 'rid',
  });
  m.createProvider.mockReturnValue({ metadata: () => ({ name: 'openai' }) });
  m.recordAiUsage.mockResolvedValue({});
  m.getConversationByPhone.mockResolvedValue(null);
  m.findBookingByPhone.mockResolvedValue({
    id: 'apt-1',
    userId: 'user-1',
    customerPhone: '+15551234567',
    customerName: 'Sam',
    serviceDescription: 'drain',
    startTime: '2026-09-18T14:00:00.000Z',
    endTime: '2026-09-18T15:00:00.000Z',
    status: 'pending',
    depositStatus: 'paid',
    googleCalendarEventId: null,
    smsHistory: [],
    rescheduledFromId: null,
    rescheduleLog: [],
  });
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

describe('processInboundSms � CP03 wiring', () => {
  it('rejects a non-E.164 From with an escalation and never touches customers', async () => {
    const worker = await loadWorker();

    await worker.processInboundSms(job({ From: 'not-a-phone', Body: 'R', To: '+15559876543' }));

    expect(m.createEscalation).toHaveBeenCalledTimes(1);
    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'processing_error' }),
    );
    expect(m.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(m.resolveOrganizationIdByTwilioNumber).not.toHaveBeenCalled();
  });

  it('escalates when the Twilio number is not registered to any org', async () => {
    const worker = await loadWorker();
    m.resolveOrganizationIdByTwilioNumber.mockResolvedValue(null);

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'R', To: '+15559876543' }));

    expect(m.createEscalation).toHaveBeenCalledTimes(1);
    expect(m.findOrCreateCustomer).not.toHaveBeenCalled();
  });

  it('creates customer + conversation + message, then dispatches the intent', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'help', confidence: 1 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });

    await worker.processInboundSms(job({
      From: '+15551234567',
      Body: 'help',
      To: '+15559876543',
      MessageSid: 'SM1234567890',
    }));

    expect(m.resolveOrganizationIdByTwilioNumber).toHaveBeenCalledWith('+15559876543');
    expect(m.findOrCreateCustomer).toHaveBeenCalledWith('org-1', '+15551234567');
    expect(m.findOrCreateConversation).toHaveBeenCalledWith('cust-1', 'sms');
    expect(m.appendMessage).toHaveBeenCalledWith(
      'conv-1',
      'inbound',
      'help',
      'SM1234567890',
      { From: '+15551234567', To: '+15559876543' },
    );
    expect(m.sendSms).toHaveBeenCalledTimes(1); // help SMS
  });

  it('escalates when the domain write fails, without dispatching the intent', async () => {
    const worker = await loadWorker();
    m.appendMessage.mockRejectedValue(new Error('insert failed'));

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'R', To: '+15559876543' }));

    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'processing_error' }),
    );
    expect(m.classifyStep).not.toHaveBeenCalled();
  });

    it('reschedule intent with no conversation state falls back to the most recent booking by phone', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'reschedule', confidence: 0.95 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.getConversationByPhone.mockResolvedValue(null);
    m.findBookingByPhone.mockResolvedValue({ ...BOOKING, id: 'apt-byphone' });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    expect(m.findBookingByPhone).toHaveBeenCalledWith('org-1', '+15551234567');
    expect(m.initiateRescheduleFlow).toHaveBeenCalledWith(
      'apt-byphone',
      '+15551234567',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('reschedule intent uses booking_id from existing conversation state when present', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'reschedule', confidence: 0.95 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.getConversationByPhone.mockResolvedValue({ id: 'conv-9', bookingId: 'apt-fromstate' });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    expect(m.initiateRescheduleFlow).toHaveBeenCalledWith(
      'apt-fromstate',
      '+15551234567',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
    expect(m.findBookingByPhone).not.toHaveBeenCalled();
  });

  it('sends no-matching-booking SMS when neither path finds a booking (no escalation)', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'reschedule', confidence: 0.95 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.getConversationByPhone.mockResolvedValue(null);
    m.findBookingByPhone.mockResolvedValue(null);

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    expect(m.initiateRescheduleFlow).not.toHaveBeenCalled();
    expect(m.sendSms).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15551234567' }),
    );
    expect(m.createEscalation).not.toHaveBeenCalled(); // informative dead-end, not an incident
  });

  it('confirm success persists the reschedule and sends a confirmation SMS', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'confirm', confidence: 0.99 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.confirmReschedule.mockResolvedValue({
      success: true,
      booking: BOOKING,
      conversation: { id: 'conv-1', state: 'completed' },
    });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    expect(m.confirmReschedule).toHaveBeenCalledTimes(1);
    expect(m.confirmReschedule).toHaveBeenCalledWith(
      '+15551234567',
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
    // Persist: org-scoped update with the confirmed slot + event id.
    expect(m.updateBookingTimes).toHaveBeenCalledWith('org-1', 'apt-1', {
      startTime: BOOKING.startTime,
      endTime: BOOKING.endTime,
      status: 'confirmed',
      googleCalendarEventId: null,
    });
    // Customer gets the confirmation SMS (with the new time).
    expect(m.sendSms).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15551234567',
        body: expect.stringContaining('confirmed'),
      }),
    );
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  it('confirm dead-end (no conversation) gets no-matching-booking SMS', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'confirm', confidence: 0.99 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.confirmReschedule.mockResolvedValue({ success: false, error: 'No conversation found' });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    expect(m.sendSms).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("wasn't able to find a booking") }),
    );
    expect(m.updateBookingTimes).not.toHaveBeenCalled();
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  it('confirm failure (calendar error) sends a courtesy SMS, no booking update', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'confirm', confidence: 0.99 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.confirmReschedule.mockResolvedValue({ success: false, error: 'Calendar event creation failed: boom' });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    expect(m.sendSms).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Our team will contact you') }),
    );
    expect(m.updateBookingTimes).not.toHaveBeenCalled();
    // Escalation for calendar failures is created inside reschedule-service.
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  it('slot-choice with no offering conversation sends an invalid-choice SMS (no escalation)', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'slot-choice', confidence: 0.9 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.processSlotChoice.mockResolvedValue(null);

    await worker.processInboundSms(job({ From: '+15551234567', Body: '2', To: '+15559876543' }));

    expect(m.processSlotChoice).toHaveBeenCalledWith('+15551234567', 2);
    expect(m.sendSms).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Reply with 1, 2, or 3') }),
    );
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  it('slot-choice failure escalates as processing_error', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'slot-choice', confidence: 0.9 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.processSlotChoice.mockRejectedValue(new Error('state write failed'));

    await worker.processInboundSms(job({ From: '+15551234567', Body: '1', To: '+15559876543' }));

    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'processing_error', customerPhone: '+15551234567' }),
    );
    expect(m.sendSms).not.toHaveBeenCalled();
  });

  it('LLM path: records one ai-usage row and dispatches the reschedule flow', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'reschedule', confidence: 0.95 },
      aiUsage: { tokensInput: 100, tokensOutput: 40, model: 'gpt-4o-mini' },
      source: 'llm',
      requestId: 'rid-llm',
    });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    // Ledger: exactly one row, org-scoped, with provider metadata + classify result.
    expect(m.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(m.recordAiUsage).toHaveBeenCalledWith({
      requestId: expect.any(String), // worker-generated UUID, not the mock's requestId
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensInput: 100,
      tokensOutput: 40,
      source: 'llm',
      organizationId: 'org-1',
    });
    // The LLM intent still dispatches through the normal reschedule path.
    expect(m.initiateRescheduleFlow).toHaveBeenCalledWith(
      'apt-1',
      '+15551234567',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  it('rule path: aiUsage null means NO ledger row, dispatch unchanged', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'help', confidence: 1 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid-rule',
    });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'help', To: '+15559876543' }));

    expect(m.recordAiUsage).not.toHaveBeenCalled();
    expect(m.sendSms).toHaveBeenCalledTimes(1); // help SMS still dispatched
  });

  it('escalation source: exactly ONE escalation row, no ambiguous re-escalation', async () => {
    const worker = await loadWorker();
    // classifyStep's terminal fallback escalates internally then returns
    // source 'escalation' with intent 'unknown'. Simulate that contract,
    // including the internal onEscalate call with the placeholder phone.
    m.classifyStep.mockImplementation(async (_provider, _ctx, onEscalate, _requestId) => {
      await onEscalate({
        type: 'ambiguous_intent',
        customerPhone: 'unknown',
        content: 'Inbound message could not be classified: "???"',
      });
      return {
        intentResult: { intent: 'unknown', confidence: 0 },
        aiUsage: null,
        source: 'escalation',
        requestId: 'rid-esc',
      };
    });

    await worker.processInboundSms(job({ From: '+15551234567', Body: '???', To: '+15559876543' }));

    // The only escalation is the one classifyStep raised — the worker's
    // onEscalate override swaps the fake "unknown" phone for the real one.
    expect(m.createEscalation).toHaveBeenCalledTimes(1);
    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ambiguous_intent', customerPhone: '+15551234567' }),
    );
    // The switch guard must NOT double-escalate; and no LLM ran, so no ledger row.
    expect(m.recordAiUsage).not.toHaveBeenCalled();
  });

  it('recordAiUsage failure never kills the job: message still dispatches', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'help', confidence: 1 },
      aiUsage: { tokensInput: 100, tokensOutput: 40, model: 'gpt-4o-mini' },
      source: 'llm',
      requestId: 'rid-ledgerfail',
    });
    m.recordAiUsage.mockRejectedValue(new Error('ledger down'));

    await expect(
      worker.processInboundSms(job({ From: '+15551234567', Body: 'help', To: '+15559876543' })),
    ).resolves.toBeUndefined();

    // The ledger failed, but the classify result still dispatched normally.
    expect(m.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledTimes(1);
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  describe('processInboundSms: T14 verification gate', () => {
    /** Unverified customer row shape (migration 010 columns). */
    function unverifiedCustomer(overrides: Record<string, unknown> = {}) {
      return {
        id: 'cust-1',
        organizationId: 'org-1',
        name: null,
        phone: '+15551234567',
        email: null,
        phoneVerifiedAt: null,
        verificationCode: null,
        verificationCodeExpiresAt: null,
        verificationAttempts: 0,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
      };
    }

    /** Find the recorded UPDATE against the verification pool by SQL fragment. */
    function gateUpdate(sqlFragment: string): [string, unknown[]] | undefined {
      return (m.poolQuery.mock.calls as Array<[string, unknown[]]>).find(([sql]) =>
        sql.includes(sqlFragment),
      );
    }

    it('unverified + no code: issues a code SMS, persists it, completes the job without classifying', async () => {
      const worker = await loadWorker();
      m.findOrCreateCustomer.mockResolvedValue(unverifiedCustomer());

      await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

      // Every inbound is still recorded (appendMessage unchanged).
      expect(m.appendMessage).toHaveBeenCalledTimes(1);
      // Exactly one SMS: the code, sent to the From number.
      expect(m.sendSms).toHaveBeenCalledTimes(1);
      expect(m.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+15551234567',
          body: expect.stringMatching(/^Your verification code is \d{6}\. Reply with it to continue\.$/),
        }),
      );
      // Persisted: code + 10-min TTL (attempts reset to 0).
      const update = gateUpdate('set verification_code = $2');
      expect(update).toBeDefined();
      expect(update![1]).toEqual(['cust-1', expect.stringMatching(/^\d{6}$/)]);
      // NO classify, NO intent dispatch, NO escalation.
      expect(m.classifyStep).not.toHaveBeenCalled();
      expect(m.initiateRescheduleFlow).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('unverified + expired code: a fresh code is re-issued, no classify', async () => {
      const worker = await loadWorker();
      m.findOrCreateCustomer.mockResolvedValue(
        unverifiedCustomer({
          verificationCode: '111111',
          verificationCodeExpiresAt: '2020-01-01T00:00:00.000Z', // long expired
          verificationAttempts: 1,
        }),
      );

      await worker.processInboundSms(job({ From: '+15551234567', Body: '111111', To: '+15559876543' }));

      expect(m.sendSms).toHaveBeenCalledTimes(1);
      const body = m.sendSms.mock.calls[0][0].body as string;
      expect(body).toMatch(/^Your verification code is \d{6}\. Reply with it to continue\.$/);
      expect(body).not.toContain('111111'); // a NEW code, never the stale one
      // Re-issue path wrote code + TTL + counter reset.
      expect(gateUpdate('set verification_code = $2')).toBeDefined();
      expect(m.classifyStep).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('unverified + correct code: verified flag persisted, "Number verified!" sent, then the SAME message is classified', async () => {
      const worker = await loadWorker();
      m.findOrCreateCustomer.mockResolvedValue(
        unverifiedCustomer({
          verificationCode: '246810',
          verificationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
        }),
      );
      m.classifyStep.mockResolvedValue({
        intentResult: { intent: 'help', confidence: 1 },
        aiUsage: null,
        source: 'rule',
        requestId: 'rid-verify',
      });

      await worker.processInboundSms(job({ From: '+15551234567', Body: '246810', To: '+15559876543' }));

      // Verified flag persisted + code/TTL cleared + attempts reset.
      const verify = gateUpdate('phone_verified_at = now()');
      expect(verify).toBeDefined();
      expect(verify![0]).toContain('verification_attempts = 0');
      // Confirm SMS, then the normal dispatch for THIS message (help SMS).
      expect(m.sendSms).toHaveBeenCalledWith(expect.objectContaining({ body: 'Number verified!' }));
      expect(m.classifyStep).toHaveBeenCalledTimes(1);
      expect(m.classifyStep).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ body: '246810' }),
        expect.any(Function),
        expect.any(String),
      );
      expect(m.sendSms).toHaveBeenCalledTimes(2); // "Number verified!" + help SMS
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('wrong code under the limit: attempt counter incremented, "try again" SMS, no classify', async () => {
      const worker = await loadWorker();
      m.findOrCreateCustomer.mockResolvedValue(
        unverifiedCustomer({
          verificationCode: '246810',
          verificationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
          verificationAttempts: 0,
        }),
      );

      await worker.processInboundSms(job({ From: '+15551234567', Body: '000000', To: '+15559876543' }));

      expect(m.sendSms).toHaveBeenCalledTimes(1);
      expect(m.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ body: "That doesn't match — try again." }),
      );
      expect(gateUpdate('verification_attempts = verification_attempts + 1')).toBeDefined();
      expect(m.classifyStep).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('wrong code on the 3rd attempt: a fresh code is re-issued (lockout = re-issue loop), classify never runs', async () => {
      const worker = await loadWorker();
      m.findOrCreateCustomer.mockResolvedValue(
        unverifiedCustomer({
          verificationCode: '246810',
          verificationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
          verificationAttempts: 2, // two prior mismatches already counted
        }),
      );

      await worker.processInboundSms(job({ From: '+15551234567', Body: '000000', To: '+15559876543' }));

      expect(m.sendSms).toHaveBeenCalledTimes(1);
      const body = m.sendSms.mock.calls[0][0].body as string;
      expect(body).toMatch(/^Your verification code is \d{6}\. Reply with it to continue\.$/);
      expect(body).not.toContain('try again'); // re-issue, not a retry prompt
      expect(m.classifyStep).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('verified customer: gate skipped entirely, zero gate DB writes, classify runs normally', async () => {
      const worker = await loadWorker();
      // beforeEach default customer is already verified.
      m.classifyStep.mockResolvedValue({
        intentResult: { intent: 'help', confidence: 1 },
        aiUsage: null,
        source: 'rule',
        requestId: 'rid-verified',
      });

      await worker.processInboundSms(job({ From: '+15551234567', Body: 'help', To: '+15559876543' }));

      expect(m.classifyStep).toHaveBeenCalledTimes(1);
      expect(m.sendSms).toHaveBeenCalledTimes(1); // help SMS only
      expect(m.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('help') }),
      );
      expect(m.poolQuery).not.toHaveBeenCalled(); // gate never touches the DB
      expect(m.createEscalation).not.toHaveBeenCalled();
    });
  });

  describe('processInboundSms: T15 confirm-code gate (sensitive intents)', () => {
    /** Conversation-state row shape (migration 011 columns included). */
    function confirmConversation(overrides: Record<string, unknown> = {}) {
      return {
        id: 'state-1',
        phone: '+15551234567',
        userId: 'user-1',
        bookingId: 'apt-1',
        state: 'awaiting_slot_choice',
        offeredSlots: null,
        selectedSlot: null,
        escalationReason: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        completedAt: null,
        confirmationCodeHash: null,
        confirmationCodeExpiresAt: null,
        confirmationAttempts: 0,
        ...overrides,
      };
    }

    /** Find the recorded UPDATE against the gate pool by SQL fragment. */
    function gateUpdate(sqlFragment: string): [string, unknown[]] | undefined {
      return (m.poolQuery.mock.calls as Array<[string, unknown[]]>).find(([sql]) =>
        sql.includes(sqlFragment),
      );
    }

    function classifyAs(intent: string) {
      m.classifyStep.mockResolvedValue({
        intentResult: { intent, confidence: 0.99 },
        aiUsage: null,
        source: 'rule',
        requestId: 'rid-t15',
      });
    }

    it('first CONFIRM: issues a code SMS, moves state to awaiting_confirmation_code, NO calendar mutation', async () => {
      const worker = await loadWorker();
      classifyAs('confirm');
      m.getConversationByPhone.mockResolvedValue(confirmConversation()); // awaiting_slot_choice, no code yet

      await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

      // Inbound message still recorded by the unchanged pre-gate layer.
      expect(m.appendMessage).toHaveBeenCalledTimes(1);
      // Exactly one SMS: the code, plaintext in the body, 6 digits.
      expect(m.sendSms).toHaveBeenCalledTimes(1);
      const body = m.sendSms.mock.calls[0][0].body as string;
      expect(body).toMatch(/^Reply with \d{6} to confirm your appointment change\.$/);
      // Persisted: ONLY the sha256 hash (+ 10-min TTL + attempt reset), never the plaintext.
      const issue = gateUpdate('confirmation_code_hash = $2');
      expect(issue).toBeDefined();
      expect(issue![1]).toEqual(['state-1', expect.stringMatching(/^[0-9a-f]{64}$/)]);
      expect(issue![0]).toContain("state = 'awaiting_confirmation_code'");
      expect(issue![0]).toContain("interval '10 minutes'");
      // NO mutation: no confirmReschedule, no booking persist, no confirm SMS.
      expect(m.confirmReschedule).not.toHaveBeenCalled();
      expect(m.updateBookingTimes).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('correct code reply: fields cleared, confirmReschedule called ONCE, normal confirmation SMS follows', async () => {
      const worker = await loadWorker();
      m.getConversationByPhone.mockResolvedValue(
        confirmConversation({
          state: 'awaiting_confirmation_code',
          confirmationCodeHash: sha256Hex('482913'),
          confirmationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
        }),
      );
      m.confirmReschedule.mockResolvedValue({
        success: true,
        booking: BOOKING,
        conversation: { id: 'state-1', state: 'completed' },
      });

      await worker.processInboundSms(job({ From: '+15551234567', Body: '482913', To: '+15559876543' }));

      // The code reply is NOT an intent: never classified (a 6-digit code is
      // unknown to the parser), never escalated.
      expect(m.classifyStep).not.toHaveBeenCalled();
      // Handshake cleared atomically with the state restore.
      const clear = gateUpdate('confirmation_code_hash = null');
      expect(clear).toBeDefined();
      expect(clear![0]).toContain("state = 'awaiting_slot_choice'");
      expect(clear![1]).toEqual(['state-1']);
      // Mutation ran exactly once, then the booking persist + confirmation SMS.
      expect(m.confirmReschedule).toHaveBeenCalledTimes(1);
      expect(m.updateBookingTimes).toHaveBeenCalledTimes(1);
      expect(m.sendSms).toHaveBeenCalledTimes(1);
      expect(m.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+15551234567',
          body: expect.stringContaining('confirmed'),
        }),
      );
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('wrong code under the limit: attempts incremented, re-ask SMS, NO mutation and NO classify', async () => {
      const worker = await loadWorker();
      m.getConversationByPhone.mockResolvedValue(
        confirmConversation({
          state: 'awaiting_confirmation_code',
          confirmationCodeHash: sha256Hex('482913'),
          confirmationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
        }),
      );

      await worker.processInboundSms(job({ From: '+15551234567', Body: '000000', To: '+15559876543' }));

      expect(gateUpdate('confirmation_attempts = confirmation_attempts + 1')).toBeDefined();
      // Retry (not a re-issue): the SAME code stays pending, no fresh-code SMS.
      expect(m.sendSms).toHaveBeenCalledTimes(1);
      expect(m.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ body: "That code didn't match — try again." }),
      );
      expect(m.confirmReschedule).not.toHaveBeenCalled();
      expect(m.updateBookingTimes).not.toHaveBeenCalled();
      expect(m.classifyStep).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('wrong code on the 3rd attempt: a FRESH code is re-issued, no mutation', async () => {
      const worker = await loadWorker();
      m.getConversationByPhone.mockResolvedValue(
        confirmConversation({
          state: 'awaiting_confirmation_code',
          confirmationCodeHash: sha256Hex('482913'),
          confirmationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
          confirmationAttempts: 2, // two prior mismatches already counted
        }),
      );

      await worker.processInboundSms(job({ From: '+15551234567', Body: '000000', To: '+15559876543' }));

      // Attempt counter incremented, then a fresh code re-issued (new hash + reset).
      expect(gateUpdate('confirmation_attempts = confirmation_attempts + 1')).toBeDefined();
      const issue = gateUpdate('confirmation_code_hash = $2');
      expect(issue).toBeDefined();
      expect(issue![1]).toEqual(['state-1', expect.stringMatching(/^[0-9a-f]{64}$/)]);
      // Exactly one SMS: the fresh code (not a retry prompt).
      expect(m.sendSms).toHaveBeenCalledTimes(1);
      const body = m.sendSms.mock.calls[0][0].body as string;
      expect(body).toMatch(/^Reply with \d{6} to confirm your appointment change\.$/);
      expect(body).not.toContain("didn't match");
      expect(m.confirmReschedule).not.toHaveBeenCalled();
      expect(m.updateBookingTimes).not.toHaveBeenCalled();
      expect(m.classifyStep).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('stale/expired code: a fresh code is re-issued without a mutation', async () => {
      const worker = await loadWorker();
      m.getConversationByPhone.mockResolvedValue(
        confirmConversation({
          state: 'awaiting_confirmation_code',
          confirmationCodeHash: sha256Hex('482913'),
          confirmationCodeExpiresAt: '2020-01-01T00:00:00.000Z', // long expired
          confirmationAttempts: 1,
        }),
      );

      await worker.processInboundSms(job({ From: '+15551234567', Body: '482913', To: '+15559876543' }));

      expect(gateUpdate('confirmation_code_hash = $2')).toBeDefined();
      const body = m.sendSms.mock.calls[0][0].body as string;
      expect(body).toMatch(/^Reply with \d{6} to confirm your appointment change\.$/);
      expect(m.confirmReschedule).not.toHaveBeenCalled();
      expect(m.updateBookingTimes).not.toHaveBeenCalled();
      expect(m.classifyStep).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('slot-choice mid-navigation (no pending confirm): gate never runs, flow unaffected', async () => {
      const worker = await loadWorker();
      classifyAs('slot-choice');
      m.getConversationByPhone.mockResolvedValue(confirmConversation({ state: 'offering_slots' }));
      m.processSlotChoice.mockResolvedValue(confirmConversation({ state: 'awaiting_slot_choice' }));

      await worker.processInboundSms(job({ From: '+15551234567', Body: '2', To: '+15559876543' }));

      expect(m.processSlotChoice).toHaveBeenCalledWith('+15551234567', 2);
      // No confirm-code gate activity at all: zero gate DB writes, no SMS,
      // no mutation.
      expect(m.poolQuery).not.toHaveBeenCalled();
      expect(m.sendSms).not.toHaveBeenCalled();
      expect(m.confirmReschedule).not.toHaveBeenCalled();
      expect(m.createEscalation).not.toHaveBeenCalled();
    });

    it('CONFIRM while still offering slots (mid-navigation): no code issued, pre-T15 dead-end preserved', async () => {
      const worker = await loadWorker();
      classifyAs('confirm');
      m.getConversationByPhone.mockResolvedValue(confirmConversation({ state: 'offering_slots' }));
      m.confirmReschedule.mockResolvedValue({
        success: false,
        error: 'Conversation not in awaiting_slot_choice state',
      });

      await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

      expect(m.poolQuery).not.toHaveBeenCalled(); // the gate did NOT issue a code
      expect(m.confirmReschedule).toHaveBeenCalledTimes(1); // dead-end reported as before
      expect(m.sendSms).toHaveBeenCalledTimes(1);
      expect(m.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("wasn't able to find a booking"),
        }),
      );
      expect(m.createEscalation).not.toHaveBeenCalled();
    });
  });
});
