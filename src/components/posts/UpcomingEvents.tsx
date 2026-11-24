import Link from "next/link";
import { Badge, Card, CardHeader, Icon } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ORG_TZ, todayInOrg } from "@/lib/format";

export function eventWhen(v: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ORG_TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(v)).replace(/am|pm/, (m) => m.toUpperCase());
}
export function daysAway(v: string) {
  const d = Math.round((Date.parse(todayInOrg(new Date(v)) + "T00:00:00Z") - Date.parse(todayInOrg() + "T00:00:00Z")) / 86_400_000);
  return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`;
}

/** Dashboard card: the next few events (hidden when there are none). */
export async function UpcomingEvents() {
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("id,title,starts_at,location").eq("status", "scheduled").gt("starts_at", new Date().toISOString()).order("starts_at").limit(3);
  if (!data?.length) return null;
  return (
    <Card className="p-5">
      <CardHeader icon="event" eyebrow="Coming up" title="Upcoming events" action={<Link href="/events" className="text-body-sm font-semibold text-secondary hover:underline">All events →</Link>} />
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {data.map((e) => (
          <li key={e.id}>
            <Link href={`/events?id=${e.id}`} className="block h-full rounded-xl border border-border-subtle bg-surface-alt/40 p-3 transition-colors hover:border-secondary/50">
              <Badge tone="purple">{daysAway(e.starts_at)}</Badge>
              <div className="mt-2 font-heading text-body-lg text-ink">{e.title}</div>
              <div className="mt-1 flex items-center gap-1 text-body-sm text-muted-text"><Icon name="schedule" className="text-[15px]" />{eventWhen(e.starts_at)}</div>
              {e.location && <div className="flex items-center gap-1 truncate text-body-sm text-muted-text"><Icon name="location_on" className="text-[15px]" />{e.location}</div>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
