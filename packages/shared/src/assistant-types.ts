// RidgeLine Assistant chat contract (tradesperson ↔ assistant widget, POST /api/assistant).
export type AssistantRole = 'user' | 'assistant';

export type AssistantMessage = {
  role: AssistantRole;
  content: string;
};

export type AssistantAction = 'none' | 'reschedule' | 'billing' | 'emergency';

export type AssistantChatRequest = {
  /** Chat history; the LAST message must have role 'user'. */
  messages: AssistantMessage[];
  /** Optional server-provided context (e.g. today's appointments summary). */
  contextSnippet?: string;
  /** Display name of the tradesperson the assistant fronts for. */
  tradespersonName?: string;
  /** Customer phone (E.164-ish) when the thread concerns one customer; used for escalations. */
  customerPhone?: string;
};

export type AssistantChatResponse = {
  reply: string;
  action: AssistantAction;
  /** True when an escalation row was created for this turn (billing / emergency). */
  escalated: boolean;
};