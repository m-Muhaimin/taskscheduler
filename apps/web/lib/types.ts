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
