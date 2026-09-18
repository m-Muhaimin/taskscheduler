import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  parseIntent: vi.fn(),
  getConversationByPhone: vi.fn(),
  sendSms: vi.fn(),
  initiateRescheduleFlow: vi.fn(),
  processSlotChoice: vi.fn(),
  confirmReschedule: vi.fn(),
}));

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
vi.mock('../services/intent-service.js', () => ({
  parseIntent: m.parseIntent,
}));
vi.mock('../services/conversation-service.js', () => ({
  getConversationByPhone: m.getConversationByPhone,
}));
vi.mock('../services/sms-service.js', () => ({
  sendSms: m.sendSms,
}));
vi.mock('../services/reschedule-service.js', () => ({
  initiateRescheduleFlow: m.initiateRescheduleFlow,
  processSlotChoice: m.processSlotChoice,
  confirmReschedule: m.confirmReschedule,
}));

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
  for (const fn of Object.values(m)) fn.mockReset();
  m.findOrCreateCustomer.mockResolvedValue({ id: 'cust-1', organizationId: 'org-1' });
  m.findOrCreateConversation.mockResolvedValue({ id: 'conv-1', status: 'open' });
  m.appendMessage.mockResolvedValue({ id: 'msg-1' });
  m.resolveOrganizationIdByTwilioNumber.mockResolvedValue('org-1');
  m.getConversationByPhone.mockResolvedValue(null);
});

afterEach(() => {
  vi.resetModules();
});

describe('processInboundSms — CP03 wiring', () => {
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
    m.parseIntent.mockReturnValue({ intent: 'help', confidence: 1 });

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
    expect(m.parseIntent).not.toHaveBeenCalled();
  });

  it('reschedule intent reaches the real flow without a crash (defaultAuth landmine fixed)', async () => {
    // fix-worker-defaultAuth.md: the real typed defaultAuth (calendar-service)
    // replaces the undefined identifier. With the booking lookup still stubbed
    // to null the flow dead-ends silently (initiateRescheduleFlow returns null) —
    // that stub is removed by implement-booking-lookup.md.
    const worker = await loadWorker();
    m.parseIntent.mockReturnValue({ intent: 'reschedule', confidence: 0.95 });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    expect(m.initiateRescheduleFlow).toHaveBeenCalledTimes(1); // no ReferenceError
    expect(m.createEscalation).not.toHaveBeenCalled(); // silent dead-end (booking stub null)
  });
});
