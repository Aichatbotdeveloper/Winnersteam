import { fmtDate } from "@/lib/format";

export const LIST_NAME: Record<string, string> = { todo: "To-do checklists", weekly: "Weekly goals", monthly: "Monthly goals", prospecting: "Prospecting" };

export function periodLabel(type: string, start: string, end: string) {
  if (type === "monthly") return fmtDate(start, { month: "long", year: "numeric" });
  return `Week of ${fmtDate(start, { day: "numeric", month: "short" })} – ${fmtDate(end, { day: "numeric", month: "short", year: "numeric" })}`;
}
export const SCOPE_LABEL: Record<string, string> = { member: "Personal", team: "My team", organisation: "Organisation" };
