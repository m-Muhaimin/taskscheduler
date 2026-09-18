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
  findBookingById: vi.fn(),
  findBookingByPhone: vi.fn(),
  findUserProfile: vi.fn(),
  updateBookingTimes: vi.fn(),
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
vi.mock('../services/booking-service.js', () => ({
  findBookingById: m.findBookingById,
  findBookingByPhone: m.findBookingByPhone,
  findUserProfile: m.findUserProfile,
  updateBookingTimes: m.updateBookingTimes,
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
  for (const fn of Object.values(m)) fn.mockReset();
  m.findOrCreateCustomer.mockResolvedValue({ id: 'cust-1', organizationId: 'org-1' });
  m.findOrCreateConversation.mockResolvedValue({ id: 'conv-1', status: 'open' });
  m.appendMessage.mockResolvedValue({ id: 'msg-1' });
  m.resolveOrganizationIdByTwilioNumber.mockResolvedValue('org-1');
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

    it('reschedule intent with no conversation state falls back to the most recent booking by phone', async () => {
    const worker = await loadWorker();
    m.parseIntent.mockReturnValue({ intent: 'reschedule', confidence: 0.95 });
    m.getConversationByPhone.mockResolvedValue(null);
    m.findBookingByPhone.mockResolvedValue({ ...BOOKING, id: 'apt-byphone' });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    expect(m.findBookingByPhone).toHaveBeenCalledWith('org-1', '+15551234567');
    expect(m.initiateRescheduleFlow).toHaveBeenCalledWith(
      'apt-byphone',
      '+15551234567',
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('reschedule intent uses booking_id from existing conversation state when present', async () => {
    const worker = await loadWorker();
    m.parseIntent.mockReturnValue({ intent: 'reschedule', confidence: 0.95 });
    m.getConversationByPhone.mockResolvedValue({ id: 'conv-9', bookingId: 'apt-fromstate' });

    await worker.processInboundSms(job({ From: '+15551234567', Body: 'RESCHEDULE', To: '+15559876543' }));

    expect(m.initiateRescheduleFlow).toHaveBeenCalledWith(
      'apt-fromstate',
      '+15551234567',
      expect.anything(),
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
    m.parseIntent.mockReturnValue({ intent: 'reschedule', confidence: 0.95 });
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
    m.parseIntent.mockReturnValue({ intent: 'confirm', confidence: 0.99 });
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
    m.parseIntent.mockReturnValue({ intent: 'confirm', confidence: 0.99 });
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
    m.parseIntent.mockReturnValue({ intent: 'confirm', confidence: 0.99 });
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
    m.parseIntent.mockReturnValue({ intent: 'slot-choice', confidence: 0.9 });
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
    m.parseIntent.mockReturnValue({ intent: 'slot-choice', confidence: 0.9 });
    m.processSlotChoice.mockRejectedValue(new Error('state write failed'));

    await worker.processInboundSms(job({ From: '+15551234567', Body: '1', To: '+15559876543' }));

    expect(m.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'processing_error', customerPhone: '+15551234567' }),
    );
    expect(m.sendSms).not.toHaveBeenCalled();
  });
});
