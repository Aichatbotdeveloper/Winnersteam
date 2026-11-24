import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, Icon, PageHeader, cn } from "@/components/ui";
import { ActionForm, ConfirmAction, ModalButton, SubmitButton } from "@/components/ui/client";
import { EventForm, type EventRow } from "@/components/posts/EventForm";
import { daysAway, eventWhen } from "@/components/posts/UpcomingEvents";
import { cancelEvent, rsvpEvent } from "@/server/actions/posts";
import { addDays, todayInOrg } from "@/lib/format";
import { toLocalInput } from "@/lib/checklists";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const me = await requireUser();
  const { id: focus } = await searchParams;
  const isSuper = me.role === "super_admin";
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [up, past, mine, everyone, admins] = await Promise.all([
    supabase.from("events").select("*").eq("status", "scheduled").gt("starts_at", nowIso).order("starts_at").limit(50),
    supabase.from("events").select("*").or(`starts_at.lte.${nowIso},status.eq.cancelled`).order("starts_at", { ascending: false }).limit(6),
    supabase.from("event_rsvps").select("event_id,response,user_id,user:profiles(full_name)"),
    isSuper ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "approved") : Promise.resolve({ count: 0 }),
    isSuper ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "approved").in("role", ["administrator", "super_admin"]) : Promise.resolve({ count: 0 }),
  ]);
  const rsvps = (mine.data ?? []) as unknown as { event_id: string; response: string; user_id: string; user: { full_name: string } | null }[];
  const myRsvp = new Map(rsvps.filter((r) => r.user_id === me.id).map((r) => [r.event_id, r.response]));
  const counts = { everyone: Math.max(0, (everyone.count ?? 1) - 1), admins: Math.max(0, (admins.count ?? 1) - 1) };
  const imgPaths = [...(up.data ?? []), ...(past.data ?? [])].map((e) => e.image_path).filter(Boolean) as string[];
  const signed = imgPaths.length ? (await supabase.storage.from("posts").createSignedUrls(imgPaths, 3600)).data ?? [] : [];
  const img = new Map(signed.map((s) => [s.path ?? "", s.signedUrl]));
  const defaults = { date: addDays(todayInOrg(), 7), time: "10:00" };

  const card = (e: EventRow, upcoming: boolean) => {
    const going = rsvps.filter((r) => r.event_id === e.id && r.response === "going");
    const notGoing = rsvps.filter((r) => r.event_id === e.id && r.response === "not_going");
    const pic = e.image_path ? img.get(e.image_path) : null;
    const isPdf = e.image_path?.endsWith(".pdf");
    return (
      <Card key={e.id} id={`event-${e.id}`} className={cn("scroll-mt-24 overflow-hidden", focus === e.id && "ring-2 ring-secondary", e.status === "cancelled" && "opacity-70")}>
        <div className="flex flex-col sm:flex-row">
          {pic && !isPdf && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pic} alt="" className="h-44 w-full object-cover sm:h-auto sm:w-56" />
          )}
          <div className="flex-1 p-5">
            <div className="flex flex-wrap items-center gap-2">
              {e.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : upcoming ? <Badge tone="purple">{daysAway(e.starts_at)}</Badge> : <Badge tone="neutral">Past</Badge>}
              {e.audience === "admins" && <Badge tone="blue">Administrators only</Badge>}
              {myRsvp.get(e.id) === "going" && <Badge tone="green" dot>You&apos;re attending</Badge>}
            </div>
            <h3 className="mt-2 font-heading text-heading-md text-ink">{e.title}</h3>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-body-md text-muted-text">
              <span className="flex items-center gap-1"><Icon name="schedule" className="text-[17px]" />{eventWhen(e.starts_at)}</span>
              {e.location && (/^https?:\/\//.test(e.location)
                ? <a href={e.location} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-secondary hover:underline"><Icon name="videocam" className="text-[17px]" />Join link</a>
                : <span className="flex items-center gap-1"><Icon name="location_on" className="text-[17px]" />{e.location}</span>)}
              {pic && isPdf && <a href={pic} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-secondary hover:underline"><Icon name="description" className="text-[17px]" />Flyer (PDF)</a>}
            </div>
            {e.description && <p className="mt-3 whitespace-pre-wrap text-body-md text-body-text">{e.description}</p>}
            {upcoming && e.status === "scheduled" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                {!isSuper && <>
                  <ActionForm action={rsvpEvent} showMessage={false}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="response" value="going" />
                    <SubmitButton size="sm" variant={myRsvp.get(e.id) === "going" ? "success" : "outline"} icon="check_circle">I&apos;ll attend</SubmitButton></ActionForm>
                  <ActionForm action={rsvpEvent} showMessage={false}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="response" value="not_going" />
                    <SubmitButton size="sm" variant={myRsvp.get(e.id) === "not_going" ? "secondary" : "ghost"} icon="event_busy">Can&apos;t attend</SubmitButton></ActionForm>
                </>}
                {isSuper && <>
                  <span className="text-body-sm text-muted-text"><strong className="text-ink">{going.length}</strong> attending · <strong className="text-ink">{notGoing.length}</strong> can&apos;t attend</span>
                  {going.length + notGoing.length > 0 && (
                    <ModalButton label="See replies" title={`Replies: ${e.title}`} icon="groups" variant="ghost" size="sm">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div><div className="label">Attending ({going.length})</div><ul className="space-y-1 text-body-md">{going.map((r) => <li key={r.user_id}>{r.user?.full_name}</li>)}</ul></div>
                        <div><div className="label">Can&apos;t attend ({notGoing.length})</div><ul className="space-y-1 text-body-md">{notGoing.map((r) => <li key={r.user_id}>{r.user?.full_name}</li>)}</ul></div>
                      </div>
                    </ModalButton>)}
                  <span className="ml-auto flex gap-2">
                    <ModalButton label="Edit" title="Edit event" icon="edit" variant="ghost" size="sm" wide>
                      <EventForm event={e} counts={counts} defaults={{ date: toLocalInput(e.starts_at).slice(0, 10), time: toLocalInput(e.starts_at).slice(11) }} />
                    </ModalButton>
                    <ConfirmAction action={cancelEvent} fields={{ id: e.id }} label="Cancel event" icon="event_busy" variant="ghost" confirm={`Cancel "${e.title}"? Everyone will be told.`} />
                  </span>
                </>}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <>
      <PageHeader eyebrow="Community" title="Events & Meetings"
        description={isSuper ? "Post an event and everyone is notified, then reminded every day at 8 AM until the day, and 1 hour before." : "Upcoming events and meetings. You'll get a reminder every morning until the day, and 1 hour before."}
        actions={isSuper ? <ModalButton label="New event" title="New event or meeting" icon="add" wide><EventForm counts={counts} defaults={defaults} /></ModalButton> : undefined} />
      <section className="mb-8 space-y-4">
        <h2 className="font-heading text-heading-md text-ink">Upcoming</h2>
        {(up.data ?? []).length === 0 ? <Card><EmptyState icon="event_available" title="No upcoming events">{isSuper ? "Press New event to post one." : "New events will appear here, and you'll be notified."}</EmptyState></Card>
          : (up.data as EventRow[]).map((e) => card(e, true))}
      </section>
      {(past.data ?? []).length > 0 && (
        <section className="space-y-4">
          <h2 className="font-heading text-heading-md text-ink">Recent</h2>
          {(past.data as EventRow[]).map((e) => card(e, false))}
        </section>
      )}
    </>
  );
}
