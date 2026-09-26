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
  resolveStaffByPhone: vi.fn(),
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
  getOrgContextByUserId: vi.fn(),
  poolQuery: vi.fn(), // T14: the worker's own verification-gate pg pool
  recordSmsOptIn: vi.fn(), // consent write point (SMS only)
}));

vi.mock('pg', () => ({ Pool: class MockPool { query = m.poolQuery; } }));

vi.mock('../services/conversation-domain.js', () => ({
  findOrCreateCustomer: m.findOrCreateCustomer,
  findOrCreateConversation: m.findOrCreateConversation,
  appendMessage: m.appendMessage,
}));
vi.mock('../services/organization-service.js', () => ({
  resolveOrganizationIdByTwilioNumber: m.resolveOrganizationIdByTwilioNumber,
  getOrgContextByUserId: m.getOrgContextByUserId,
}));
vi.mock('../services/staff-phone-service.js', () => ({
  resolveStaffByPhone: m.resolveStaffByPhone,
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
vi.mock('../services/consent-service.js', () => ({
  recordSmsOptIn: m.recordSmsOptIn,
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
  m.getOrgContextByUserId.mockResolvedValue({ timezone: 'Asia/Dhaka' });
  m.resolveStaffByPhone.mockResolvedValue(null); // T16: default non-staff
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

    expect(m.processSlotChoice).toHaveBeenCalledWith(
      '+15551234567',
      2,
      undefined,
      undefined,
      expect.any(Function), // channel-aware sms sender (T17: same-channel replies)
    );
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

      expect(m.processSlotChoice).toHaveBeenCalledWith(
        '+15551234567',
        2,
        undefined,
        undefined,
        expect.any(Function), // channel-aware sms sender (T17)
      );
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

describe('processInboundSms: T16 staff-phone operator flow', () => {
  it('staff From -> staff_sms escalation + ack, NO customer row, NO classify', async () => {
    const worker = await loadWorker();
    m.resolveStaffByPhone.mockResolvedValue({
      tradespersonId: 'tp-1',
      email: '__VG_EMAIL_staff1__',
    });

    await worker.processInboundSms(job({
      From: '+15551234567',
      Body: 'hi team, can you cover my shift',
      To: '+15559876543',
    }));

    // Operator flow: escalation surface + ack, job completes.
    expect(m.resolveStaffByPhone).toHaveBeenCalledWith('+15551234567', 'org-1');
    expect(m.createEscalation).toHaveBeenCalledTimes(1);
    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'staff_sms',
        customerPhone: '+15551234567',
        content: expect.stringContaining('[staff sms from tp-1]'),
      }),
    );
    expect(m.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15551234567' }),
    );
    // Hard invariant: staff messages never enter the customer pipeline.
    expect(m.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(m.findOrCreateConversation).not.toHaveBeenCalled();
    expect(m.appendMessage).not.toHaveBeenCalled();
    expect(m.classifyStep).not.toHaveBeenCalled();
  });

  it('non-staff From -> existing customer flow runs unchanged (regression)', async () => {
    const worker = await loadWorker();
    // Default beforeEach: resolveStaffByPhone -> null, verified customer.

    await worker.processInboundSms(job({
      From: '+15551234567',
      Body: 'help',
      To: '+15559876543',
      MessageSid: 'SM1234567890',
    }));

    expect(m.resolveStaffByPhone).toHaveBeenCalledWith('+15551234567', 'org-1');
    expect(m.findOrCreateCustomer).toHaveBeenCalledWith('org-1', '+15551234567');
    expect(m.classifyStep).toHaveBeenCalled();
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  it('staff of ANOTHER org -> treated as customer (org-scoped resolution)', async () => {
    const worker = await loadWorker();
    // resolveStaffByPhone already enforces organization_id = $2; at the worker
    // level a cross-org staff number resolves to null and hits the customer
    // flow exactly like an unknown number.
    m.resolveStaffByPhone.mockResolvedValue(null);

    await worker.processInboundSms(job({
      From: '+15551234567',
      Body: 'hello',
      To: '+15559876543',
    }));

    expect(m.resolveStaffByPhone).toHaveBeenCalledWith('+15551234567', 'org-1');
    expect(m.findOrCreateCustomer).toHaveBeenCalledWith('org-1', '+15551234567');
    expect(m.createEscalation).not.toHaveBeenCalled();
  });
});

describe('processInboundSms: SMS consent write point', () => {
  it('records the opt-in for a valid inbound customer SMS before classifying', async () => {
    const worker = await loadWorker();

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'need to move my appointment' }),
    );

    expect(m.recordSmsOptIn).toHaveBeenCalledTimes(1);
    expect(m.recordSmsOptIn).toHaveBeenCalledWith('cust-1');
    // The opt-in is written before the intent is classified, so the gate in
    // sms-service.ts can already see it for any send this flow triggers.
    expect(m.classifyStep).toHaveBeenCalled();
  });

  it('is idempotent: a repeat message from the same customer re-records without failing', async () => {
    const worker = await loadWorker();

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
    );
    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM2', Body: 'hello again' }),
    );

    expect(m.recordSmsOptIn).toHaveBeenCalledTimes(2);
    expect(m.recordSmsOptIn).toHaveBeenNthCalledWith(1, 'cust-1');
    expect(m.recordSmsOptIn).toHaveBeenNthCalledWith(2, 'cust-1');
  });

  it('records the opt-in even while the verification gate is still running', async () => {
    const worker = await loadWorker();
    m.findOrCreateCustomer.mockResolvedValue({
      id: 'cust-1',
      organizationId: 'org-1',
      name: null,
      phone: '+15551234567',
      email: null,
      phoneVerifiedAt: null,
      verificationCode: '246810',
      verificationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
      verificationAttempts: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
    );

    // Consent is recorded; classify does not run (the gate owns this message).
    expect(m.recordSmsOptIn).toHaveBeenCalledWith('cust-1');
    expect(m.classifyStep).not.toHaveBeenCalled();
  });

  it('does NOT record the opt-in for a staff phone (operator flow returns first)', async () => {
    const worker = await loadWorker();
    m.resolveStaffByPhone.mockResolvedValue({ tradespersonId: 'trades-1', userId: 'user-1' });

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'on my way' }),
    );

    expect(m.recordSmsOptIn).not.toHaveBeenCalled();
    expect(m.findOrCreateCustomer).not.toHaveBeenCalled();
  });

  it('a consent write failure FAILS VISIBLY: the job rejects and never classifies', async () => {
    const worker = await loadWorker();
    m.recordSmsOptIn.mockRejectedValue(new Error('consent db down'));

    await expect(
      worker.processInboundSms(
        job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
      ),
    ).rejects.toThrow('consent db down');

    expect(m.classifyStep).not.toHaveBeenCalled();
  });

  it('does not record the opt-in for a non-E.164 sender (rejected before any customer write)', async () => {
    const worker = await loadWorker();

    await worker.processInboundSms(
      job({ From: '+15551234567:ext1', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
    );

    expect(m.recordSmsOptIn).not.toHaveBeenCalled();
    expect(m.createEscalation).toHaveBeenCalledTimes(1);
  });

  // --- The gated-send interaction -----------------------------------------
  // handleRescheduleIntent's flowSmsSender sends with a `customerId` and NO
  // `kind`, so sms-service.ts's outbound consent gate applies to it. These two
  // tests stand in for that gate and assert the ordering contract this file
  // can prove: the opt-in record exists BEFORE any gated send in the same
  // inbound turn, and it is written once per inbound job, not once per send.

  it('a gated reply send (customerId, no kind) does not throw: the opt-in write lands first', async () => {
    const worker = await loadWorker();
    let optedIn = false;
    m.recordSmsOptIn.mockImplementation(async () => {
      optedIn = true;
    });
    // Mirror of sms-service.ts's gate: no customerId passes, a transactional
    // kind passes, anything else needs a logged consent record or it throws.
    m.sendSms.mockImplementation(async (input: { customerId?: string; kind?: string }) => {
      if (input.customerId && !input.kind && !optedIn) {
        throw new Error(`SMS consent required for ${input.customerId}`);
      }
      return { messageSid: 'SM-sent', status: 'queued' };
    });
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'reschedule', confidence: 0.95 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.getConversationByPhone.mockResolvedValue(null);
    m.initiateRescheduleFlow.mockImplementation(
      async (_bookingId, _phone, _auth, _freebusy, _events, _byId, _profile, smsSendFn) => {
        await smsSendFn({ to: '+15551234567', body: 'Here are three times that work.' });
      },
    );

    await expect(
      worker.processInboundSms(
        job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'need to move my appointment' }),
      ),
    ).resolves.toBeUndefined();

    expect(m.recordSmsOptIn).toHaveBeenCalledTimes(1);
    // The send really is a gated one: customerId present, kind absent.
    const gated = m.sendSms.mock.calls[0][0] as { customerId?: string; kind?: string; organizationId?: string };
    expect(gated.customerId).toBe('cust-1');
    expect(gated.organizationId).toBe('org-1');
    expect(gated.kind).toBeUndefined();
    // Ordering: the opt-in write precedes the send it exists to satisfy.
    expect(m.recordSmsOptIn.mock.invocationCallOrder[0]).toBeLessThan(
      m.sendSms.mock.invocationCallOrder[0],
    );
    expect(m.createEscalation).not.toHaveBeenCalled();
  });

  it('records the opt-in ONCE per inbound job, not once per gated send', async () => {
    const worker = await loadWorker();
    m.classifyStep.mockResolvedValue({
      intentResult: { intent: 'reschedule', confidence: 0.95 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid',
    });
    m.getConversationByPhone.mockResolvedValue(null);
    m.initiateRescheduleFlow.mockImplementation(
      async (_bookingId, _phone, _auth, _freebusy, _events, _byId, _profile, smsSendFn) => {
        await smsSendFn({ to: '+15551234567', body: 'Here are three times that work.' });
        await smsSendFn({ to: '+15551234567', body: 'Reply 1, 2, or 3 to pick one.' });
      },
    );

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'need to move my appointment' }),
    );

    // Two gated sends, one consent write: the opt-in is per inbound, not per send.
    expect(m.sendSms).toHaveBeenCalledTimes(2);
    expect(m.recordSmsOptIn).toHaveBeenCalledTimes(1);
    expect(m.recordSmsOptIn).toHaveBeenCalledWith('cust-1');
  });
});

// ---------------------------------------------------------------------------
// C1 repair: the consent gate in sms-service.ts exempts any send that does not
// name a customer. Before this repair 7 of the 8 automated customer-facing
// sends in this file rode that exemption, so the gate was documentation rather
// than enforcement. These tests assert the threading: every automated
// customer-facing send names the in-scope customer and its MessagingKind, and
// the operator-facing / dev-harness sends stay exempt on purpose.
// ---------------------------------------------------------------------------

/** The five transactional OTP kinds, verbatim from sms-service.ts. */
const TRANSACTIONAL_OTP_KINDS = new Set([
  'verification_code',
  'confirm_code',
  'number_verified',
  'code_mismatch',
  'confirm_failed',
]);

interface GateInput {
  to?: string;
  body?: string;
  kind?: string;
  customerId?: string;
  organizationId?: string;
}

interface GateState {
  optIn: boolean;
  /** Kinds the mirror gate refused — must stay empty on every happy path. */
  refused: string[];
}

describe('processInboundSms: automated sends are consent-gated', () => {
  /**
   * Stand-in for sms-service.ts's assertSmsConsent. `../services/sms-service.js`
   * is mocked wholesale in this file, so the real gate cannot run here; this
   * mirrors it exactly — no customerId → ungated, a transactional OTP kind →
   * ungated, anything else naming a customer → refused unless a consent record
   * exists. `optIn` starts false and flips only when recordSmsOptIn runs, so a
   * send admitted with optIn still false was admitted by the ALLOWLIST.
   */
  function mountConsentGate(): GateState {
    const state: GateState = { optIn: false, refused: [] };
    m.recordSmsOptIn.mockImplementation(async () => {
      state.optIn = true;
    });
    m.sendSms.mockImplementation(async (input: GateInput) => {
      if (
        input.customerId &&
        !TRANSACTIONAL_OTP_KINDS.has(input.kind as string) &&
        !state.optIn
      ) {
        state.refused.push(input.kind ?? '(no kind)');
        throw new Error('sendSms: blocked — no SMS consent record for this customer');
      }
      return { messageSid: 'SM-gate', status: 'queued' };
    });
    return state;
  }

  /** The worst case for the gate: the consent write lands and records nothing. */
  function mountGateWithoutConsent(): GateState {
    const state = mountConsentGate();
    m.recordSmsOptIn.mockResolvedValue(undefined);
    return state;
  }

  /** sendSms invocations recorded for the current job, in order. */
  function sends(): GateInput[] {
    return m.sendSms.mock.calls.map((call) => call[0] as GateInput);
  }

  function classifyAs(intent: string) {
    m.classifyStep.mockResolvedValue({
      intentResult: { intent, confidence: 0.99 },
      aiUsage: null,
      source: 'rule',
      requestId: 'rid-gate',
    });
  }

  function unverifiedRow(overrides: Record<string, unknown> = {}) {
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

  function stateRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'state-1',
      phone: '+15551234567',
      userId: 'user-1',
      bookingId: 'apt-1',
      state: 'awaiting_confirmation_code',
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

  function confirmedBooking() {
    return {
      success: true,
      booking: BOOKING,
      conversation: { id: 'state-1', state: 'completed' },
    };
  }

  /** The single send of the job, asserted to name the customer and its kind. */
  function expectGatedSend(kind: string) {
    const list = sends();
    expect(list).toHaveLength(1);
    expect(list[0].customerId).toBe('cust-1');
    expect(list[0].kind).toBe(kind);
    expect(list[0].organizationId).toBe('org-1');
  }

  it('help: names the customer and the help kind', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    classifyAs('help');

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'help', To: '+15559876543' }));

    expectGatedSend('help');
    expect(gate.refused).toEqual([]);
  });

  it('no_matching_booking: names the customer and the no_matching_booking kind', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    classifyAs('no-matching-booking');

    await worker.processInboundSms(
      job({ From: '+15551234567', Body: 'where is my job', To: '+15559876543' }),
    );

    expectGatedSend('no_matching_booking');
    expect(gate.refused).toEqual([]);
  });

  it('no_matching_booking via the reschedule dead-end: still gated', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    classifyAs('reschedule');
    m.getConversationByPhone.mockResolvedValue(null);
    m.findBookingByPhone.mockResolvedValue(null);

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    expectGatedSend('no_matching_booking');
    expect(gate.refused).toEqual([]);
  });

  it('slot_invalid: names the customer and the slot_invalid kind', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    classifyAs('slot-choice');
    m.processSlotChoice.mockResolvedValue(null);

    await worker.processInboundSms(job({ From: '+15551234567', Body: '2', To: '+15559876543' }));

    expectGatedSend('slot_invalid');
    expect(gate.refused).toEqual([]);
  });

  it('slot_choice: the in-flow confirm prompt names the customer too', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    classifyAs('slot-choice');
    m.processSlotChoice.mockImplementation(
      async (_phone: string, _choice: number, _lookup: unknown, _update: unknown, smsSendFn: (i: GateInput) => Promise<unknown>) => {
        await smsSendFn({ to: '+15551234567', body: 'Reply YES to confirm this slot.' });
        return stateRow({ state: 'awaiting_slot_choice' });
      },
    );

    await worker.processInboundSms(job({ From: '+15551234567', Body: '2', To: '+15559876543' }));

    // reschedule-service sets no kind, so this one is gated on consent alone —
    // the same contract as the reschedule flow's flowSmsSender.
    const list = sends();
    expect(list).toHaveLength(1);
    expect(list[0].customerId).toBe('cust-1');
    expect(list[0].organizationId).toBe('org-1');
    expect(gate.refused).toEqual([]);
  });

  it('confirm_failed: names the customer and the transactional confirm_failed kind', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent(); // no consent record at all
    classifyAs('confirm');
    m.getConversationByPhone.mockResolvedValue(null);
    m.confirmReschedule.mockResolvedValue({
      success: false,
      error: 'Calendar event creation failed: boom',
    });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    // Admitted by the allowlist, not by a consent record.
    expectGatedSend('confirm_failed');
    expect(gate.optIn).toBe(false);
    expect(gate.refused).toEqual([]);
  });

  it('booking_confirmation: names the customer and the booking_confirmation kind', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    classifyAs('confirm');
    m.getConversationByPhone.mockResolvedValue(null);
    m.confirmReschedule.mockResolvedValue(confirmedBooking());

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    expectGatedSend('booking_confirmation');
    expect(gate.refused).toEqual([]);
  });

  it('non-vacuity: with no consent record the confirmation SMS is REFUSED, not just annotated', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    classifyAs('confirm');
    m.getConversationByPhone.mockResolvedValue(null);
    m.confirmReschedule.mockResolvedValue(confirmedBooking());

    // A send that fails the gate propagates, so the surrounding catch escalates
    // instead of reaching Twilio. Pre-repair this send carried no customerId
    // and would have gone out ungated — which is exactly what this asserts.
    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    expect(gate.refused).toEqual(['booking_confirmation']);
    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'processing_error' }),
    );
  });

  // --- The confirm-code handshake caller (the pre-classify branch) -----------
  // The same booking_confirmation send, reached by the OTHER caller of
  // performConfirmation: a code reply while the conversation is still
  // `awaiting_confirmation_code`. That branch runs BEFORE classify, so it never
  // passed through handleConfirmIntent. It is the caller that dropped the
  // customerId argument — the signature could not express it, so the send rode
  // the gate's `customerId == null` exemption. Two threads, two pins.

  it('confirm-code verified: the booking confirmation names the scoped customer and its kind', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    m.getConversationByPhone.mockResolvedValue(
      stateRow({
        confirmationCodeHash: sha256Hex('482913'),
        confirmationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
      }),
    );
    m.confirmReschedule.mockResolvedValue(confirmedBooking());

    await worker.processInboundSms(
      job({ From: '+15551234567', Body: '482913', To: '+15559876543' }),
    );

    // The handshake ran pre-classify, so the code reply is still never an intent.
    expect(m.classifyStep).not.toHaveBeenCalled();
    // THE PIN: the one send names the in-scope customer and is org-scoped, so
    // the ledger row carries customer_id and the consent gate really applies.
    // Drop the customerId argument at this call site and `customerId` is
    // undefined here — the send becomes exempt and this test goes red.
    expectGatedSend('booking_confirmation');
    expect(gate.optIn).toBe(true); // admitted by the consent record, not the allowlist
    expect(gate.refused).toEqual([]);
  });

  it('non-vacuity: confirm-code verified with no consent record REFUSES the confirmation SMS', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    m.getConversationByPhone.mockResolvedValue(
      stateRow({
        confirmationCodeHash: sha256Hex('482913'),
        confirmationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
      }),
    );
    m.confirmReschedule.mockResolvedValue(confirmedBooking());

    // A refused send propagates out of performConfirmation into its own catch,
    // so the job escalates instead of reaching Twilio. Pre-repair this branch
    // named no customer and the SMS would have gone out ungated — which is
    // exactly what this asserts.
    await worker.processInboundSms(
      job({ From: '+15551234567', Body: '482913', To: '+15559876543' }),
    );

    expect(gate.refused).toEqual(['booking_confirmation']);
    expect(gate.optIn).toBe(false);
    expect(m.sendSms).toHaveBeenCalledTimes(1); // attempted, and refused
    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'processing_error' }),
    );
    // The calendar mutation is NOT rolled back — the consent gate is an
    // outbound boundary, and the booking stays confirmed. Pinned so nobody
    // reads the refusal as a failed confirmation.
    expect(m.updateBookingTimes).toHaveBeenCalledTimes(1);
  });

  // --- The confirm dead-end (performConfirmation) ----------------------------
  // The same no_matching_booking body, reached by a DIFFERENT caller: the
  // confirm intent's confirmReschedule reported the conversation was gone.
  // Two threads, two pins — a dropped customerId in either is a red test
  // instead of a silently ungated customer SMS.

  it('confirm dead-end: the post-mutation no_matching_booking names the customer and its kind', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();
    classifyAs('confirm');
    m.getConversationByPhone.mockResolvedValue(null);
    m.confirmReschedule.mockResolvedValue({ success: false, error: 'No conversation found' });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    // The dead-end SMS, not the courtesy confirm-failed one.
    expectGatedSend('no_matching_booking');
    expect(m.confirmReschedule).toHaveBeenCalledTimes(1);
    expect(gate.refused).toEqual([]);
  });

  it('non-vacuity: with no consent record the confirm dead-end SMS is REFUSED, not just annotated', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    classifyAs('confirm');
    m.getConversationByPhone.mockResolvedValue(null);
    m.confirmReschedule.mockResolvedValue({ success: false, error: 'No conversation found' });

    // A refused send propagates out of performConfirmation into its own catch,
    // so the job escalates instead of reaching Twilio. Drop the customerId
    // argument at this call site and `refused` stays empty — the same ungated
    // send the assertion above pins shut.
    await worker.processInboundSms(job({ From: '+15551234567', Body: 'CONFIRM', To: '+15559876543' }));

    expect(gate.refused).toEqual(['no_matching_booking']);
    expect(gate.optIn).toBe(false);
    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'processing_error' }),
    );
  });

  // --- The five OTP / handshake sites ---------------------------------------
  // These must name the customer AND a transactional kind. The allowlist (not
  // the no-customerId exemption) is what admits them, so the verification
  // handshake can never deadlock against the consent record it produces.

  it('T14 verification_code: names the customer and the verification_code kind', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    m.findOrCreateCustomer.mockResolvedValue(unverifiedRow());

    await expect(
      worker.processInboundSms(job({ From: '+15551234567', Body: 'hello', To: '+15559876543' })),
    ).resolves.toBeUndefined();

    const list = sends();
    expect(list).toHaveLength(1);
    expect(list[0].customerId).toBe('cust-1');
    expect(list[0].kind).toBe('verification_code');
    expect(gate.optIn).toBe(false);
    expect(gate.refused).toEqual([]);
  });

  it('T14 number_verified: names the customer and the number_verified kind', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    m.findOrCreateCustomer.mockResolvedValue(
      unverifiedRow({
        verificationCode: '246810',
        verificationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
      }),
    );
    classifyAs('unknown');

    await worker.processInboundSms(
      job({ From: '+15551234567', Body: '246810', To: '+15559876543' }),
    );

    const list = sends();
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('Number verified!');
    expect(list[0].customerId).toBe('cust-1');
    expect(list[0].kind).toBe('number_verified');
    expect(gate.refused).toEqual([]);
  });

  it('T14 code_mismatch: names the customer and the code_mismatch kind', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    m.findOrCreateCustomer.mockResolvedValue(
      unverifiedRow({
        verificationCode: '246810',
        verificationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
      }),
    );

    await worker.processInboundSms(
      job({ From: '+15551234567', Body: '000000', To: '+15559876543' }),
    );

    const list = sends();
    expect(list).toHaveLength(1);
    expect(list[0].customerId).toBe('cust-1');
    expect(list[0].kind).toBe('code_mismatch');
    expect(gate.refused).toEqual([]);
  });

  it('T15 confirm_code: names the customer and the confirm_code kind', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    m.getConversationByPhone.mockResolvedValue(stateRow());

    await worker.processInboundSms(
      job({ From: '+15551234567', Body: '482913', To: '+15559876543' }),
    );

    const list = sends();
    expect(list).toHaveLength(1);
    expect(list[0].body).toMatch(/^Reply with \d{6} to confirm your appointment change\.$/);
    expect(list[0].customerId).toBe('cust-1');
    expect(list[0].kind).toBe('confirm_code');
    expect(gate.refused).toEqual([]);
  });

  it('T15 code_mismatch: names the customer and the code_mismatch kind', async () => {
    const worker = await loadWorker();
    const gate = mountGateWithoutConsent();
    m.getConversationByPhone.mockResolvedValue(
      stateRow({
        confirmationCodeHash: sha256Hex('482913'),
        confirmationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
      }),
    );

    await worker.processInboundSms(
      job({ From: '+15551234567', Body: '000000', To: '+15559876543' }),
    );

      const list = sends();
      expect(list).toHaveLength(1);
      expect(list[0].body).toBe("That code didn't match — try again.");
      expect(list[0].customerId).toBe('cust-1');
      expect(list[0].kind).toBe('code_mismatch');
      expect(gate.refused).toEqual([]);
    });

    it('T15 lockout re-issue: the 3rd wrong code names the customer and the confirm_code kind', async () => {
      const worker = await loadWorker();
      const gate = mountGateWithoutConsent();
      // Two prior mismatches already counted, so this wrong code trips the
      // lockout and re-issues a fresh code. That is the SECOND caller of
      // issueFlowCodeAndSend (the first-CONFIRM site is the other), and the
      // one that had no pin: drop its customerId argument and this SMS goes
      // out exempt.
      m.getConversationByPhone.mockResolvedValue(
        stateRow({
          confirmationCodeHash: sha256Hex('482913'),
          confirmationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
          confirmationAttempts: 2,
        }),
      );

      await worker.processInboundSms(
        job({ From: '+15551234567', Body: '000000', To: '+15559876543' }),
      );

      const list = sends();
      expect(list).toHaveLength(1);
      // The fresh code, not the retry prompt.
      expect(list[0].body).toMatch(/^Reply with \d{6} to confirm your appointment change\.$/);
      expect(list[0].customerId).toBe('cust-1');
      expect(list[0].kind).toBe('confirm_code');
      // This one names no organizationId, so the gate keys off customerId
      // alone (and the send writes no ledger row) — pinned so a future
      // "simplification" is a visible contract change, not a silent one.
      expect(list[0].organizationId).toBeUndefined();
      // Admitted by the allowlist, not by a consent record.
      expect(gate.optIn).toBe(false);
      expect(gate.refused).toEqual([]);
      // A re-issue stops the flow: no mutation, and the code reply is never
      // classified as an intent.
      expect(m.confirmReschedule).not.toHaveBeenCalled();
      expect(m.classifyStep).not.toHaveBeenCalled();
    });

  // --- The deliberate exemptions --------------------------------------------

  it('staff ack stays exempt: no customerId and no kind (it addresses the operator)', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate(); // optIn stays false: the staff flow returns before the write
    m.resolveStaffByPhone.mockResolvedValue({ tradespersonId: 'trades-1', userId: 'user-1' });

    await worker.processInboundSms(
      job({ From: '+15551234567', Body: 'on my way', To: '+15559876543' }),
    );

    expect(m.recordSmsOptIn).not.toHaveBeenCalled();
    expect(m.findOrCreateCustomer).not.toHaveBeenCalled();
    const ack = sends();
    expect(ack).toHaveLength(1);
    // The key must be ABSENT, not present-and-undefined: a blank/empty id is
    // the one shape that could later be mistaken for "gated".
    expect(ack[0]).not.toHaveProperty('customerId');
    expect(ack[0]).not.toHaveProperty('kind');
    expect(ack[0].organizationId).toBe('org-1');
    expect(gate.refused).toEqual([]);
  });
});
