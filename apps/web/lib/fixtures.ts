import type { Appointment, Customer, InboxItem, JobRow, StatItem } from "./types";
import type { MetricGridItem } from "@/components/dashboard/metric-grid";

// In v1, these are local-only mocks. Swap each export below for a real
// fetch against the API once the corresponding domain table exists
// (see docs/tasks/v2/ Checkpoints 03-04 in the taskscheduler repo).

export const overviewStats: StatItem[] = [
  { id: "appointments", value: 12, label: "appointments today" },
  { id: "leads", value: 8, label: "new leads this week" },
  { id: "booked", value: 4280, prefix: "$", label: "booked this week" },
  { id: "booking-rate", value: 92, suffix: "%", label: "AI booking rate", tone: "success" },
  { id: "attention", value: 3, label: "need attention", tone: "danger" },
];

export const keyMetrics: MetricGridItem[] = [
  {
    id: "appointments",
    href: "/dashboard/schedule",
    label: "Appointments today",
    value: 12,
    chartData: [7, 8, 6, 9, 10, 9, 12],
    trend: { deltaLabel: "+3 vs yesterday", direction: "up", good: true },
  },
  {
    id: "leads",
    href: "/dashboard/customers",
    label: "New leads this week",
    value: 8,
    chartData: [3, 4, 4, 6, 5, 7, 8],
    trend: { deltaLabel: "+27%", direction: "up", good: true },
  },
  {
    id: "booked",
    href: "/dashboard/jobs",
    label: "Booked this week",
    value: 4280,
    prefix: "$",
    chartData: [2100, 2600, 2400, 3100, 3400, 3900, 4280],
    trend: { deltaLabel: "+18%", direction: "up", good: true },
  },
  {
    id: "booking-rate",
    href: "/dashboard/analytics",
    label: "AI booking rate",
    value: 92,
    suffix: "%",
    tone: "success",
    chartData: [81, 84, 86, 88, 90, 91, 92],
    trend: { deltaLabel: "+4pts", direction: "up", good: true },
  },
  {
    id: "attention",
    href: "/dashboard/inbox",
    label: "Need attention",
    value: 3,
    tone: "danger",
    chartData: [6, 5, 6, 4, 5, 4, 3],
    trend: { deltaLabel: "-2 vs yesterday", direction: "down", good: true },
  },
];

export const inboxItems: InboxItem[] = [
  {
    id: "1",
    name: "John Whitfield",
    state: "attention",
    lastMessage: "\u201cThere's water pouring through the ceiling right now.\u201d",
    suggestion: "AI paused \u2014 flagged as possible emergency.",
    time: "2m ago",
    channel: "SMS",
  },
  {
    id: "2",
    name: "Priya Anand",
    state: "active",
    lastMessage: "\u201cCan someone come after 5? I get off work then.\u201d",
    suggestion: "AI suggests: Tomorrow 5:30 PM \u00b7 Mike \u00b7 HVAC tune-up",
    time: "6m ago",
    channel: "SMS",
  },
  {
    id: "3",
    name: "Dale Torres",
    state: "attention",
    lastMessage: "\u201cIs the $89 diagnostic fee separate from repair cost?\u201d",
    suggestion: "AI unsure how to answer pricing question \u2014 needs your input.",
    time: "22m ago",
    channel: "SMS",
  },
  {
    id: "4",
    name: "Sarah Kim",
    state: "handled",
    lastMessage: "\u201cPerfect, see you then!\u201d",
    suggestion: "Appointment confirmed automatically.",
    time: "1h ago",
    channel: "SMS",
  },
  {
    id: "5",
    name: "Michael Ortiz",
    state: "handled",
    lastMessage: "\u201cActually can we push to Monday?\u201d",
    suggestion: "Rescheduled to Monday 10:00 AM automatically.",
    time: "3h ago",
    channel: "SMS",
  },
  {
    id: "6",
    name: "Renee Fischer",
    state: "active",
    lastMessage: "\u201cMy AC is making a rattling noise, not urgent.\u201d",
    suggestion: "AI is gathering details before offering a slot.",
    time: "4h ago",
    channel: "SMS",
  },
];

export const todayAppointments: Appointment[] = [
  { id: "1", time: "9:00", label: "Sarah Kim \u2014 Drain cleaning", tech: "Mike", topPercent: 8 },
  { id: "2", time: "10:30", label: "Priya Anand \u2014 HVAC tune-up", tech: "Dave", topPercent: 26 },
  { id: "3", time: "12:00", label: "John Whitfield \u2014 Emergency (pending)", tech: "\u2014", topPercent: 46, urgent: true },
  { id: "4", time: "2:00", label: "Renee Fischer \u2014 Diagnostic", tech: "Mike", topPercent: 68 },
  { id: "5", time: "4:30", label: "Dale Torres \u2014 Water heater repair", tech: "Dave", topPercent: 88 },
];

export const jobs: JobRow[] = [
  { id: "1", customer: "Sarah Kim", service: "Drain cleaning", technician: "Mike R.", status: "Completed", value: "$180" },
  { id: "2", customer: "Priya Anand", service: "HVAC tune-up", technician: "Dave O.", status: "Scheduled", value: "$140" },
  { id: "3", customer: "John Whitfield", service: "Emergency plumbing", technician: "\u2014", status: "Needs dispatch", value: "\u2014" },
  { id: "4", customer: "Renee Fischer", service: "AC diagnostic", technician: "Mike R.", status: "In progress", value: "$89" },
  { id: "5", customer: "Dale Torres", service: "Water heater repair", technician: "Dave O.", status: "Scheduled", value: "$420" },
  { id: "6", customer: "Elena Boyd", service: "Pipe inspection", technician: "Mike R.", status: "Completed", value: "$95" },
];

export const customers: Customer[] = [
  { id: "1", name: "Sarah Kim", phone: "(206) 555-0142", jobCount: 3, customerSince: "2025" },
  { id: "2", name: "Priya Anand", phone: "(206) 555-0198", jobCount: 1, customerSince: "2026" },
  { id: "3", name: "John Whitfield", phone: "(206) 555-0110", jobCount: 5, customerSince: "2023" },
  { id: "4", name: "Dale Torres", phone: "(206) 555-0177", jobCount: 2, customerSince: "2025" },
  { id: "5", name: "Renee Fischer", phone: "(206) 555-0164", jobCount: 1, customerSince: "2026" },
  { id: "6", name: "Elena Boyd", phone: "(206) 555-0133", jobCount: 4, customerSince: "2024" },
];

export const revenueRecovery = {
  missedCalls: 47,
  recovered: 41,
  booked: 24,
  estimatedRevenue: 6420,
  sparkline: [44, 40, 42, 30, 32, 18, 22, 10, 14],
};

export const inboundDemandByHour = [
  12, 8, 6, 4, 3, 5, 9, 18, 26, 31, 24, 20, 22, 28, 34, 30, 19, 14, 10, 7,
];

export const conversationOutcomes = [
  { label: "Booked", pct: 63, tone: "success" as const },
  { label: "Escalated to Marcus", pct: 14, tone: "danger" as const },
  { label: "Dropped off / no reply", pct: 23, tone: "muted" as const },
];
