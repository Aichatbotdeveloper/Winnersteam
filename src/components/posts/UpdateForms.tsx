"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { reviewUpdate, submitUpdate } from "@/server/actions/posts";
import { shrinkOnSelect } from "@/lib/shrinkImage";
import { EmailEstimate } from "./EventForm";

export function ShareUpdateForm() {
  return (
    <ActionForm action={submitUpdate} resetOnSuccess className="space-y-3">
      <fieldset>
        <legend className="label">What kind of update?</legend>
        <div className="flex flex-wrap gap-4 text-body-md">
          <label className="flex items-center gap-2"><input type="radio" name="kind" value="service" defaultChecked className="accent-secondary" />Service update <span className="text-muted-text">(news about a service we offer)</span></label>
          <label className="flex items-center gap-2"><input type="radio" name="kind" value="platform" className="accent-secondary" />Platform update <span className="text-muted-text">(about Winners Team)</span></label>
        </div>
      </fieldset>
      <Field label="Title"><input name="title" required maxLength={160} className="input" placeholder="e.g. Google launched a free SEO tool" /></Field>
      <Field label="Details"><textarea name="body" required minLength={3} maxLength={4000} rows={4} className="input resize-y" placeholder="What happened and why it matters to the team" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Link (optional)"><input name="link" type="url" maxLength={500} placeholder="https://…" className="input" /></Field>
        <Field label="Picture or file (optional)"><input type="file" name="attachment" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={shrinkOnSelect(1600)} className="input file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-on-secondary" /></Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body-sm text-muted-text">The Super Admin reviews it before it goes to everyone. You&apos;ll be credited.</span>
        <SubmitButton icon="send">Send for review</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PublishForm({ u, counts }: { u: { id: string; title: string; body: string }; counts: { everyone: number; admins: number } }) {
  const [audience, setAudience] = useState("everyone");
  const [email, setEmail] = useState(true);
  return (
    <ActionForm action={reviewUpdate} className="space-y-3">
      <input type="hidden" name="id" value={u.id} /><input type="hidden" name="decision" value="publish" />
      <Field label="Title (you can edit it)"><input name="title" required maxLength={160} defaultValue={u.title} className="input" /></Field>
      <Field label="Text (you can edit it)"><textarea name="body" required maxLength={4000} rows={5} defaultValue={u.body} className="input resize-y" /></Field>
      <fieldset>
        <legend className="label">Who should get it</legend>
        <div className="flex flex-wrap gap-4 text-body-md">
          {[["everyone", `Everyone (${counts.everyone})`], ["admins", `Administrators only (${counts.admins})`]].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="audience" value={v} checked={audience === v} onChange={() => setAudience(v)} className="accent-secondary" />{l}</label>
          ))}
        </div>
      </fieldset>
      <div className="rounded-lg bg-surface-container-low px-3 py-2.5">
        <label className="flex items-center gap-2 text-body-md text-ink"><input type="checkbox" name="email" checked={email} onChange={(e) => setEmail(e.target.checked)} className="h-4 w-4 accent-secondary" />Also send by e-mail</label>
        <div className="mt-1 pl-6">{email ? <EmailEstimate count={audience === "admins" ? counts.admins : counts.everyone} /> : <span className="text-body-sm text-muted-text">App and phone notifications only.</span>}</div>
      </div>
      <div className="flex justify-end"><SubmitButton variant="secondary" icon="campaign">Publish to {audience === "admins" ? counts.admins : counts.everyone} people</SubmitButton></div>
    </ActionForm>
  );
}

export function DeclineForm({ id }: { id: string }) {
  return (
    <ActionForm action={reviewUpdate} className="space-y-3">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="decline" />
      <Field label="Note to the sender (optional)"><input name="note" maxLength={500} placeholder="e.g. Thanks — we covered this last week" className="input" /></Field>
      <div className="flex justify-end"><SubmitButton variant="outline" icon="block">Don&apos;t publish</SubmitButton></div>
    </ActionForm>
  );
}
