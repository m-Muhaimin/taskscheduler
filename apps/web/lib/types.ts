export type InboxState = "attention" | "active" | "handled";

export interface InboxItem {
  id: string;
  name: string;
  state: InboxState;
  lastMessage: string;
  suggestion: string;
  time: string;
  channel: "SMS" | "Voice" | "Web";
}

export interface Appointment {
  id: string;
  time: string;
  label: string;
  tech: string;
  topPercent: number;
  urgent?: boolean;
}

export interface JobRow {
  id: string;
  customer: string;
  service: string;
  technician: string;
  status: "Completed" | "Scheduled" | "In progress" | "Needs dispatch";
  value: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  jobCount: number;
  customerSince: string;
}

export interface StatItem {
  id: string;
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  tone?: "default" | "success" | "danger";
}

export interface EscalationItem {
  id: string;
  type: string;
  typeLabel: string;
  customerPhone: string;
  content: string | null;
  status: "pending" | "resolved";
  createdAt: string;
  createdAtDisplay: string;
  resolvedAt: string | null;
  resolvedAtDisplay: string | null;
  messageSid?: string | null;
}

export interface MessageRow {
  id: string;
  toPhone: string;
  body: string;
  channel: "sms";
  kindLabel: string | null;
  status: "queued" | "sent" | "delivered" | "failed" | "retried" | "escalated" | "blocked_optin";
  statusLabel: string;
  errorCode: string | null;
  messageSid: string | null;
  createdAt: string;
  createdAtDisplay: string;
  customerName?: string | null;
}
