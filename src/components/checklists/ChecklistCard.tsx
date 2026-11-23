"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Badge, Icon, Progress, buttonClass, cn, scoreColor } from "@/components/ui";
import { ActionForm, ConfirmAction, ModalButton, SubmitButton, toast } from "@/components/ui/client";
import { addChecklistItem, deleteChecklist, deleteChecklistItem, submitChecklist, updateChecklist, updateChecklistItem } from "@/server/actions/checklists";
import { STEPS, average, checklistLabel, fmtDeadline, toLocalInput, type Checklist, type ChecklistItem } from "@/lib/checklists";
import { Countdown, useNow } from "./Countdown";

const CONSEQUENCE: Record<string, (q: number) => string> = {
  frog_jumps: (q) => `${q} frog jumps`,
  leg_raising: (q) => `${q} minutes of leg raising`,
  office_signatures: (q) => `Signatures from ${q} other office${q === 1 ? "" : "s"}`,
  financial_fine: (q) => `₦${Number(q).toLocaleString("en-NG")} fine`,
};

type Patch = { id: string; progress?: number; achieved?: number; target?: number; title?: string; remove?: boolean };

/**
 * One checklist. `editable` = the viewer owns it and it is still open.
 * `spinFor` = this viewer is the team member who would spin (shows the Spin call-to-action).
 */
export function ChecklistCard({ checklist: c, editable, spinFor }: { checklist: Checklist; editable: boolean; spinFor: boolean }) {
  const [pending, start] = useTransition();
  const [items, apply] = useOptimistic(
    [...c.items].sort((a, b) => a.position - b.position),
    (list: ChecklistItem[], p: Patch) => p.remove ? list.filter((i) => i.id !== p.id) : list.map((i) => {
      if (i.id !== p.id) return i;
      const n = { ...i, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== "id" && v !== undefined)) } as ChecklistItem;
      if (c.kind === "prospecting" && n.target) n.progress = Math.min(n.achieved / n.target, 1) * 100;
      return n;
    }),
  );
  const prospecting = c.kind === "prospecting";
  const open = c.status === "open";
  const score = open ? average(items) : c.score;
  const allDone = items.length > 0 && items.every((i) => Number(i.progress) >= 100);
  const label = checklistLabel(c.title, c.kind);
  const ev = c.event ?? null;
  const ledger = ev?.ledger?.[0] ?? null;
  const now = useNow();
  const canDelete = editable && (items.length === 0 || (now > 0 && now - new Date(c.created_at).getTime() < 15 * 60_000));

  const patch = (p: Patch, run: () => Promise<{ ok: boolean; message: string } | null>) =>
    start(async () => {
      apply(p);
      const r = await run();
      if (r && !r.ok) toast(r.message);
    });

  return (
    <article className={cn("card overflow-hidden", !open && "opacity-[0.97]")} aria-label={label}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle p-4">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-heading-md text-ink">{c.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted-text">
            <span className="inline-flex items-center gap-1"><Icon name="schedule" className="text-[16px]" />Due {fmtDeadline(c.deadline)}</span>
            {open ? <Countdown deadline={c.deadline} className="font-semibold text-secondary" />
              : <Badge tone="neutral">{c.closed_reason === "submitted" ? "Submitted early" : "Graded at deadline"}</Badge>}
          </div>
        </div>
        <div className="text-right">
          <div data-score className="font-heading text-[26px] font-bold leading-none" style={{ color: scoreColor(score) }}>
            {score === null ? "—" : `${Math.round(Number(score) * 10) / 10}%`}
          </div>
          <div className="mt-1 text-label-sm uppercase tracking-wider text-faint-text">{open ? "Live score" : "Final score"}</div>
        </div>
      </div>
      <Progress value={score ?? 0} color={scoreColor(score)} className="rounded-none" label={`${label} score`} />

      {/* Items */}
      <ul className="divide-y divide-border-subtle">
        {items.map((it) => (
          <li key={it.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                Number(it.progress) >= 100 ? "border-on-tertiary-container bg-on-tertiary-container text-white" : "border-border-strong")}>
                {Number(it.progress) >= 100 && <Icon name="check" className="text-[14px]" />}
              </span>
              <span className={cn("break-words text-body-md", Number(it.progress) >= 100 ? "text-muted-text" : "text-ink")}>{it.title}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {prospecting ? (
                <ProspectingCount item={it} editable={editable}
                  onChange={(achieved) => patch({ id: it.id, achieved }, () => updateChecklistItem({ id: it.id, achieved }))} />
              ) : editable ? (
                <div role="radiogroup" aria-label={`Progress for ${it.title}`} className="inline-flex overflow-hidden rounded-lg border border-border-subtle">
                  {STEPS.map((s) => {
                    const on = Number(it.progress) === s;
                    return (
                      <button key={s} type="button" role="radio" aria-checked={on} disabled={pending && on}
                        onClick={() => !on && patch({ id: it.id, progress: s }, () => updateChecklistItem({ id: it.id, progress: s }))}
                        className={cn("min-w-[44px] px-2 py-1.5 text-body-sm font-semibold transition-colors",
                          on ? (s === 100 ? "bg-on-tertiary-container text-white" : "bg-secondary text-on-secondary") : "bg-surface text-muted-text hover:bg-surface-container-low")}>
                        {s}%
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Badge tone={Number(it.progress) >= 100 ? "green" : Number(it.progress) > 0 ? "purple" : "neutral"}>{Math.round(Number(it.progress))}%</Badge>
              )}
              {editable && (
                <button type="button" aria-label={`Remove ${it.title}`} title="Remove item"
                  onClick={() => { if (window.confirm(`Remove "${it.title}"?`)) patch({ id: it.id, remove: true }, () => deleteChecklistItem(it.id)); }}
                  className="rounded p-1 text-faint-text hover:bg-surface-alt hover:text-accent-red">
                  <Icon name="close" className="text-[18px]" />
                </button>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-5 text-center text-body-md text-muted-text">No items yet.{editable && " Add your first item below."}</li>}
      </ul>

      {/* Add item */}
      {editable && (
        <ActionForm action={addChecklistItem} resetOnSuccess showMessage={false} className="flex flex-wrap gap-2 border-t border-border-subtle px-4 py-3">
          <input type="hidden" name="checklist_id" value={c.id} />
          <input name="title" required maxLength={200} placeholder="Add an item…" aria-label="New item" className="input min-w-0 flex-1" />
          {prospecting && <input name="target" type="number" min={1} required placeholder="Target" aria-label="Target number" className="input w-24" />}
          <SubmitButton variant="outline" icon="add">Add</SubmitButton>
        </ActionForm>
      )}

      {/* Footer: actions or outcome */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-container-low/50 px-4 py-3">
        {open ? (
          editable ? (
            <>
              <div className="flex flex-wrap gap-2">
                <ModalButton label="Edit" title="Edit checklist" icon="edit" variant="ghost" size="sm">
                  <EditForm c={c} />
                </ModalButton>
                {canDelete && <ConfirmAction action={deleteChecklist} fields={{ id: c.id }} label="Delete" icon="delete" variant="ghost"
                  confirm={`Delete "${c.title}"? This cannot be undone.`} />}
              </div>
              <div className="flex items-center gap-2">
                {allDone && <span className="text-body-sm font-semibold text-on-tertiary-container">Everything is at 100%</span>}
                <button type="button" disabled={pending || items.length === 0}
                  onClick={() => {
                    const s = average(items) ?? 0;
                    if (!window.confirm(`Submit "${c.title}" now? It will be graded at ${Math.round(s * 10) / 10}% and locked.`)) return;
                    start(async () => { const r = await submitChecklist(c.id); if (r) toast(r.message); });
                  }}
                  className={buttonClass(allDone ? "success" : "secondary", "sm")}>
                  <Icon name="send" className="text-[18px]" />Submit now
                </button>
              </div>
            </>
          ) : <span className="text-body-sm text-muted-text">Open — graded at the deadline.</span>
        ) : score === null ? (
          <span className="text-body-sm text-muted-text">This checklist had no items, so it was not graded.</span>
        ) : ledger ? (
          <span className="flex flex-wrap items-center gap-2 text-body-md text-ink">
            <Icon name="casino" className="text-[18px] text-accent-amber" />
            Outcome: <strong>{CONSEQUENCE[ledger.category]?.(Number(ledger.quantity)) ?? ledger.category}</strong>
            <Badge tone="neutral">{ledger.selected_by === "system_auto" ? "Spun by the system" : "Spun by you"}</Badge>
          </span>
        ) : ev ? (
          spinFor ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="text-body-md font-semibold text-ink">Your {label} scored {Math.round(Number(score) * 10) / 10}%. Spin the wheel</span>
              <Link href={`/accountability?event=${ev.id}`} className={buttonClass("secondary", "sm")}><Icon name="casino" className="text-[18px]" />Spin the wheel</Link>
            </div>
          ) : <Badge tone="amber">Spin pending</Badge>
        ) : (
          <span className="flex items-center gap-2 text-body-md font-semibold text-on-tertiary-container"><Icon name="verified" className="text-[18px]" />No consequence</span>
        )}
      </div>
    </article>
  );
}

function ProspectingCount({ item, editable, onChange }: { item: ChecklistItem; editable: boolean; onChange: (achieved: number) => void }) {
  const [value, setValue] = useState(String(item.achieved));
  const commit = () => {
    const n = Math.max(0, Math.floor(Number(value)));
    if (Number.isFinite(n) && n !== item.achieved) onChange(n); else setValue(String(item.achieved));
  };
  return (
    <span className="inline-flex items-center gap-2 text-body-md">
      {editable ? (
        <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          aria-label={`How many done for ${item.title}`} className="input w-20 py-1 text-right" />
      ) : <strong className="text-ink">{item.achieved}</strong>}
      <span className="text-muted-text">of {item.target}</span>
      <Badge tone={Number(item.progress) >= 100 ? "green" : "purple"}>{Math.round(Number(item.progress))}%</Badge>
    </span>
  );
}

function EditForm({ c }: { c: Checklist }) {
  const [date, time] = toLocalInput(c.deadline).split("T");
  return (
    <ActionForm action={updateChecklist} className="space-y-3">
      <input type="hidden" name="id" value={c.id} />
      <label className="block"><span className="label">Title</span><input name="title" defaultValue={c.title} required maxLength={120} className="input" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Deadline date</span><input type="date" name="deadline_date" defaultValue={date} max={date} required className="input" /></label>
        <label className="block"><span className="label">Time</span><input type="time" name="deadline_time" defaultValue={time} required className="input" /></label>
      </div>
      <p className="text-body-sm text-muted-text">You can move the deadline earlier, but not later.</p>
      <div className="flex justify-end"><SubmitButton icon="save">Save</SubmitButton></div>
    </ActionForm>
  );
}
