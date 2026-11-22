export const ORG_TZ = "Africa/Lagos";

export function pct(v: number | string | null | undefined, digits = 1) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(digits).replace(/\.0+$/, "")}%` : "—";
}

export function naira(v: number | string) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(v));
}

export function num(v: number | string | null | undefined) {
  if (v === null || v === undefined) return "0";
  return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(v));
}

export function fmtDate(v: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!v) return "—";
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T12:00:00Z") : new Date(v);
  return new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TZ, ...opts }).format(d);
}

export function fmtDateTime(v: string | Date | null | undefined) {
  return fmtDate(v, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(v: string | Date) {
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(v);
}

/** Today's date (YYYY-MM-DD) in the organisation timezone. */
export function todayInOrg(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TZ }).format(now);
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStart(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

export function monthStart(iso: string) {
  return iso.slice(0, 8) + "01";
}

export function monthEnd(iso: string) {
  const d = new Date(iso.slice(0, 8) + "01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TZ, hour: "numeric", hour12: false }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Current wall-clock time (HH:MM) in the organisation timezone. */
export function nowTimeInOrg(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

export function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
