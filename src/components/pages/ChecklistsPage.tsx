import { requireUser } from "@/lib/auth";
import { EmptyState, PageHeader, StatTile } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { ChecklistCard } from "@/components/checklists/ChecklistCard";
import { NewChecklistForm } from "@/components/checklists/NewChecklistForm";
import { KIND, defaultDeadline, type ChecklistKind } from "@/lib/checklists";
import { loadChecklists, syncMyChecklists } from "@/server/checklists";
import { pct, todayInOrg } from "@/lib/format";

export async function ChecklistsPage({ kind }: { kind: ChecklistKind }) {
  const me = await requireUser();
  await syncMyChecklists();
  const { open, closed } = await loadChecklists({ ownerId: me.id, kind });
  const k = KIND[kind];
  const today = todayInOrg();
  const dueToday = open.filter((c) => todayInOrg(new Date(c.deadline)) === today).length;
  const graded = closed.filter((c) => c.score !== null);
  const avg = graded.length ? graded.reduce((s, c) => s + Number(c.score), 0) / graded.length : null;
  const spins = closed.filter((c) => c.event && !c.event.ledger?.length).length;
  const spinFor = me.role === "team_member";

  return (
    <>
      <PageHeader eyebrow={k.eyebrow} title={k.page} description={k.blurb}
        actions={<ModalButton label="New checklist" title={`New ${k.noun}`} icon="add"><NewChecklistForm kind={kind} defaultDeadline={defaultDeadline(kind)} /></ModalButton>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open checklists" value={open.length} icon="checklist" />
        <StatTile label="Due today" value={dueToday} icon="today" tone="blue" />
        <StatTile label="Average score (30 days)" value={pct(avg)} icon="monitoring" tone="green" sub={`${graded.length} graded`} />
        <StatTile label="Spins waiting" value={spins} icon="casino" tone={spins ? "amber" : "neutral"} href={spins ? "/accountability" : undefined} />
      </div>

      <section aria-labelledby="open-heading" className="mb-8">
        <h2 id="open-heading" className="mb-3 font-heading text-heading-md text-ink">Open</h2>
        {open.length === 0 ? (
          <div className="card"><EmptyState icon="playlist_add" title={`No open ${k.noun}s`}>Press <strong>New checklist</strong>, give it a title and a deadline, and add your items.</EmptyState></div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {open.map((c) => <ChecklistCard key={c.id} checklist={c} editable spinFor={spinFor} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="graded-heading">
        <h2 id="graded-heading" className="mb-3 font-heading text-heading-md text-ink">Graded <span className="text-body-md font-normal text-muted-text">· last 30 days</span></h2>
        {closed.length === 0 ? (
          <div className="card"><EmptyState icon="history" title="Nothing graded yet">Checklists appear here once they reach their deadline or you submit them.</EmptyState></div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {closed.map((c) => <ChecklistCard key={c.id} checklist={c} editable={false} spinFor={spinFor} />)}
          </div>
        )}
      </section>
    </>
  );
}

