import type { Database } from "@/lib/database.types";

type E = Database["public"]["Enums"];

export const ROLE_LABEL: Record<E["app_role"], string> = {
  super_admin: "Super Admin", administrator: "Administrator", team_member: "Team Member",
};

export const STATUS_LABEL: Record<E["account_status"], string> = {
  pending: "Pending", approved: "Active", rejected: "Rejected", deactivated: "Deactivated", removed: "Removed",
};

export const CATEGORY_LABEL: Record<E["perf_category"], string> = {
  daily_todo: "Daily To-Do List", weekly_goals: "Weekly Goals", prospecting: "Prospecting Targets",
  monthly_goals: "Monthly Goals", additional_tasks: "Additional Tasks",
};

export const CATEGORY_COLOR: Record<E["perf_category"], string> = {
  daily_todo: "#5a45cb", weekly_goals: "#0091FF", prospecting: "#F59E0B", monthly_goals: "#8B5CF6", additional_tasks: "#10B981",
};

export const PROSPECTING_LABEL: Record<E["prospecting_activity"], string> = {
  find_prospects: "Find prospects", contact_prospects: "Contact prospects", generate_leads: "Generate leads",
  send_proposals: "Send proposals", follow_ups: "Follow-ups", appointments: "Secure appointments", conversions: "Conversions",
};

export const CONSEQUENCE_LABEL: Record<E["consequence_category"], string> = {
  frog_jumps: "Frog Jumps", leg_raising: "Leg Raising", office_signatures: "Office Signatures", financial_fine: "Financial Fine",
};

export const CONSEQUENCE_COLOR: Record<E["consequence_category"], string> = {
  frog_jumps: "#10B981", leg_raising: "#0091FF", office_signatures: "#8B5CF6", financial_fine: "#F59E0B",
};

export const CONSEQUENCE_ICON: Record<E["consequence_category"], string> = {
  frog_jumps: "directions_run", leg_raising: "accessibility_new", office_signatures: "draw", financial_fine: "payments",
};

/** Hard business limits (mirrors the database CHECK constraints). */
export const CONSEQUENCE_LIMITS: Record<E["consequence_category"], { min: number; max: number; unit: string; physical: boolean }> = {
  frog_jumps: { min: 10, max: 400, unit: "jumps", physical: true },
  leg_raising: { min: 10, max: 60, unit: "minutes", physical: true },
  office_signatures: { min: 1, max: 10, unit: "offices", physical: false },
  financial_fine: { min: 200, max: 5000, unit: "NGN", physical: false },
};

export function consequenceText(cat: E["consequence_category"], qty: number | string) {
  const q = Number(qty);
  switch (cat) {
    case "frog_jumps": return `${q} frog jumps`;
    case "leg_raising": return `${q} minutes of leg raising`;
    case "office_signatures": return `Collect signatures from ${q} other office${q === 1 ? "" : "s"}`;
    case "financial_fine": return `₦${q.toLocaleString("en-NG")} financial fine`;
  }
}

export function sectorLabel(cat: E["consequence_category"], qty: number | string) {
  const q = Number(qty);
  switch (cat) {
    case "frog_jumps": return `${q} Frog Jumps`;
    case "leg_raising": return `${q}m Leg Raise`;
    case "office_signatures": return `${q} Office Sign${q === 1 ? "" : "s"}`;
    case "financial_fine": return `₦${q.toLocaleString("en-NG")} Fine`;
  }
}

export const LEVEL_STYLE: Record<E["accountability_level"], { label: string; cls: string }> = {
  none: { label: "Target achieved", cls: "bg-accent-emerald/10 text-on-tertiary-container" },
  low: { label: "Low", cls: "bg-accent-amber/10 text-accent-amber" },
  moderate: { label: "Moderate", cls: "bg-accent-amber/15 text-warning-text" },
  high: { label: "High", cls: "bg-accent-red/10 text-accent-red" },
};

export const PRIORITY_STYLE: Record<E["task_priority"], string> = {
  low: "bg-surface-alt text-muted-text", normal: "bg-accent-blue/10 text-accent-blue",
  high: "bg-accent-amber/10 text-accent-amber", urgent: "bg-accent-red/10 text-accent-red",
};

export const NOTIFICATION_CATEGORIES = [
  ["reminders", "Reminders", "Daily, weekly, monthly and prospecting reminders. E-mail: monthly goals only"],
  ["deadlines", "Deadlines", "Overdue tasks and approaching goal deadlines. E-mail: monthly goals only"],
  ["performance", "Performance", "Performance summaries (in the app) and book recommendations"],
  ["accountability", "Accountability", "Spin outcomes and accountability updates"],
  ["assignment", "Assignments", "Administrator assignment changes"],
  ["profile", "Profile changes", "Profile modification alerts (administrators)"],
  ["service_updates", "Service updates", "New professional updates for your services"],
  ["announcements", "Announcements", "Messages from your administrator or the Super Admin"],
] as const;
