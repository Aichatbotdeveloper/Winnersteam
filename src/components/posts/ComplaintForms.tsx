"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Field, Icon, cn } from "@/components/ui";
import { ActionForm, SubmitButton, toast, type ActionResult } from "@/components/ui/client";
import { manageComplaint, submitComplaint } from "@/server/actions/posts";
import { shrinkOnSelect } from "@/lib/shrinkImage";
import { COMPLAINT_CATEGORY } from "@/lib/complaints";


export function ComplaintForm() {
  const [state, action] = useActionState<ActionResult, FormData>(submitComplaint, null);
  const [anon, setAnon] = useState(false);
  const router = useRouter();
  const code = state?.ok ? (state.data as { code: string }).code : null;
  if (code) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-emerald/15 text-on-tertiary-container"><Icon name="check_circle" className="text-[32px]" /></span>
        <h2 className="font-heading text-heading-lg text-ink">Your complaint has been sent</h2>
        <p className="text-body-md text-muted-text">Only the Super Admin can read it. Keep this reference code to check its status and read any reply{anon ? " — it is the only way to follow up on an anonymous complaint" : ""}:</p>
        <div className="mx-auto flex max-w-xs items-center justify-between gap-3 rounded-xl border-2 border-dashed border-secondary bg-surface-container-low px-4 py-3">
          <span className="font-mono text-heading-md tracking-widest text-ink">{code}</span>
          <button type="button" className="text-body-sm font-semibold text-secondary" onClick={() => { void navigator.clipboard?.writeText(code); toast("Code copied"); }}>Copy</button>
        </div>
        <p className="text-body-sm text-muted-text">We can&apos;t show this code again. Write it down or take a screenshot.</p>
        <button type="button" onClick={() => router.refresh()} className="text-body-sm font-semibold text-secondary hover:underline">Done</button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <Field label="What is it about?">
        <select name="category" required defaultValue="" className="input">
          <option value="" disabled>Choose…</option>
          {Object.entries(COMPLAINT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Describe what happened"><textarea name="body" required minLength={10} maxLength={6000} rows={6} className="input resize-y" placeholder="What happened, when, and who was involved (if you're comfortable saying)." /></Field>
      <Field label="Evidence (optional)" hint="A screenshot or PDF. Images are shrunk before sending."><input type="file" name="attachment" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={shrinkOnSelect(1600)} className="input file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-on-secondary" /></Field>
      <label className={cn("flex items-start gap-3 rounded-xl border p-3", anon ? "border-secondary bg-surface-container-low" : "border-border-subtle")}>
        <input type="checkbox" name="anonymous" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="mt-1 h-4 w-4 accent-secondary" />
        <span><span className="block font-semibold text-ink">Stay anonymous</span>
          <span className="block text-body-sm text-muted-text">Your name and account are not stored with the complaint, and the time is rounded to the hour. You&apos;ll get a code to follow up. Details you write yourself could still reveal who you are.</span></span>
      </label>
      {state && !state.ok && <p role="alert" className="rounded-lg bg-accent-red/10 px-3 py-2 text-body-md text-accent-red">{state.message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-body-sm text-muted-text"><Icon name="lock" className="text-[16px]" />Only the Super Admin can read complaints. Administrators can&apos;t see them.</span>
        <SubmitButton icon="send" pendingText="Sending…">Send complaint</SubmitButton>
      </div>
    </form>
  );
}

export function ManageComplaintForm({ c }: { c: { id: string; status: string; private_notes: string | null; reply: string | null; anonymous: boolean } }) {
  return (
    <ActionForm action={manageComplaint} className="space-y-3">
      <input type="hidden" name="id" value={c.id} />
      <Field label="Status">
        <select name="status" defaultValue={c.status} className="input">
          <option value="new">New</option><option value="reviewing">Under review</option><option value="resolved">Resolved</option>
        </select>
      </Field>
      <Field label="Private notes (only you)"><textarea name="notes" maxLength={6000} rows={3} defaultValue={c.private_notes ?? ""} className="input resize-y" /></Field>
      <Field label="Reply to the sender" hint={c.anonymous ? "They read it with their reference code." : "They are notified and read it on their Complaints page."}>
        <textarea name="reply" maxLength={4000} rows={3} defaultValue={c.reply ?? ""} className="input resize-y" /></Field>
      <div className="flex justify-end"><SubmitButton icon="save">Save</SubmitButton></div>
    </ActionForm>
  );
}

export function StatusBadge({ s }: { s: string }) {
  return <Badge tone={s === "new" ? "amber" : s === "reviewing" ? "blue" : "green"} dot>{s === "new" ? "New" : s === "reviewing" ? "Under review" : "Resolved"}</Badge>;
}
