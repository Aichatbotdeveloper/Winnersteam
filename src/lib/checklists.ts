import { addDays, monthEnd, nowTimeInOrg, todayInOrg, ORG_TZ } from "@/lib/format";

export type ChecklistKind = "todo" | "weekly" | "monthly" | "prospecting";
export const STEPS = [0, 25, 50, 75, 100] as const;

export type ChecklistItem = { id: string; title: string; progress: number; target: number | null; achieved: number; position: number };
export type Checklist = {
  id: string; kind: ChecklistKind; title: string; deadline: string; status: "open" | "closed";
  closed_at: string | null; closed_reason: "deadline" | "submitted" | null; score: number | null; created_at: string;
  items: ChecklistItem[];
  event?: { id: string; level: string; ledger: { category: string; quantity: number; unit: string; selected_by: string }[] | null } | null;
};

/** Per-kind wording and where it lives. */
export const KIND: Record<ChecklistKind, { path: string; page: string; noun: string; label: string; itemPlaceholder: string; eyebrow: string; blurb: string }> = {
  todo: {
    path: "/tasks", page: "My To-Do Checklists", noun: "to-do checklist", label: "to-do list", eyebrow: "Productivity & execution",
    itemPlaceholder: "e.g. Call three clients",
    blurb: "Create a checklist with a title and a deadline, then mark each item 0–100% as you work. Each checklist is graded on its own at its deadline, or when you press Submit now.",
  },
  weekly: {
    path: "/weekly-goals", page: "Weekly Goals", noun: "weekly goals checklist", label: "weekly goals", eyebrow: "Productivity & execution",
    itemPlaceholder: "e.g. Send 5 proposals",
    blurb: "List this week's goals as a checklist with a deadline. Mark each goal 0–100%; the checklist is graded on its own at its deadline.",
  },
  monthly: {
    path: "/monthly-goals", page: "Monthly Goals", noun: "monthly goals checklist", label: "monthly goals", eyebrow: "Productivity & execution",
    itemPlaceholder: "e.g. Close 3 new contracts",
    blurb: "List this month's goals as a checklist with a deadline. Mark each goal 0–100%; the checklist is graded on its own at its deadline.",
  },
  prospecting: {
    path: "/prospecting", page: "Prospecting", noun: "prospecting checklist", label: "prospecting list", eyebrow: "Outreach & acquisition",
    itemPlaceholder: "e.g. Contact prospects",
    blurb: "Add each target with a number (for example, contact 20 prospects). Enter how many you have done and the percentage is worked out for you.",
  },
};

/** "Office to-do list" — without doubling when the title already ends with the label. */
export function checklistLabel(title: string, kind: ChecklistKind) {
  const t = title.trim();
  const words = KIND[kind].label.split(" ");
  // Join without repeating words the title already ends with ("Prospecting" → "Prospecting list").
  for (let n = words.length; n > 0; n--) {
    if (t.toLowerCase().endsWith(words.slice(0, n).join(" "))) return [t, ...words.slice(n)].join(" ");
  }
  return `${t} ${words.join(" ")}`;
}

export function average(items: { progress: number }[]) {
  if (!items.length) return null;
  return Math.round((items.reduce((s, i) => s + Number(i.progress), 0) / items.length) * 100) / 100;
}

/** Sensible default deadline (local "YYYY-MM-DDTHH:mm") for a new checklist. */
export function defaultDeadline(kind: ChecklistKind, now = new Date()) {
  const today = todayInOrg(now);
  const late = nowTimeInOrg(now) >= "17:30";
  if (kind === "weekly") {
    const dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 Sun … 5 Fri
    let d = addDays(today, (5 - dow + 7) % 7);
    if (d === today && late) d = addDays(d, 7);
    return `${d}T18:00`;
  }
  if (kind === "monthly") {
    let d = monthEnd(today);
    if (d === today && late) d = monthEnd(addDays(today, 1));
    return `${d}T18:00`;
  }
  return `${late ? addDays(today, 1) : today}T18:00`;
}

/** Local "YYYY-MM-DDTHH:mm" in the org time zone for a timestamp. */
export function toLocalInput(v: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(v));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** "Today, 4:00 PM" / "Fri 28 Nov, 6:00 PM" in the org time zone. */
export function fmtDeadline(v: string, now = new Date()) {
  const day = todayInOrg(new Date(v));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(v)).toUpperCase();
  const today = todayInOrg(now);
  if (day === today) return `Today, ${time}`;
  if (day === addDays(today, 1)) return `Tomorrow, ${time}`;
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(v))}, ${time}`;
}
