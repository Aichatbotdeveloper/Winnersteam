import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Checklist, ChecklistKind } from "@/lib/checklists";

const SELECT = "id,kind,title,deadline,status,closed_at,closed_reason,score,created_at,owner_id," +
  "items:checklist_items(id,title,progress,target,achieved,position)," +
  "event:accountability_events(id,level,auto_draw_at,ledger:accountability_ledger(category,quantity,unit,selected_by))";

function normalise(rows: unknown[]): Checklist[] {
  return (rows as (Checklist & { event: unknown })[]).map((r) => {
    const ev = Array.isArray(r.event) ? r.event[0] ?? null : r.event ?? null;
    const e = ev as (Checklist["event"] & { ledger: unknown }) | null;
    return {
      ...r,
      score: r.score === null ? null : Number(r.score),
      items: (r.items ?? []).map((i) => ({ ...i, progress: Number(i.progress) })),
      event: e ? { ...e, ledger: Array.isArray(e.ledger) ? e.ledger : e.ledger ? [e.ledger] : [] } : null,
    } as Checklist;
  });
}

/** Grade anything that is due (and auto-spin overdue spins) for the signed-in user first. */
export async function syncMyChecklists() {
  const supabase = await createClient();
  await supabase.rpc("sync_my_checklists");
}

export async function loadChecklists(opts: { ownerId: string; kind?: ChecklistKind; closedSinceDays?: number; openOnly?: boolean; limit?: number }) {
  const supabase = await createClient();
  const since = new Date(Date.now() - (opts.closedSinceDays ?? 30) * 86_400_000).toISOString();
  let open = supabase.from("checklists").select(SELECT).eq("owner_id", opts.ownerId).eq("status", "open").order("deadline");
  let closed = supabase.from("checklists").select(SELECT).eq("owner_id", opts.ownerId).eq("status", "closed").gte("closed_at", since)
    .order("closed_at", { ascending: false }).limit(opts.limit ?? 60);
  if (opts.kind) { open = open.eq("kind", opts.kind); closed = closed.eq("kind", opts.kind); }
  const [o, c] = await Promise.all([open, opts.openOnly ? Promise.resolve({ data: [] }) : closed]);
  return { open: normalise(o.data ?? []), closed: normalise(c.data ?? []) };
}
