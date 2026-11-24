"use client";

import { useState } from "react";
import { Field, Icon } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { saveEvent } from "@/server/actions/posts";
import { shrinkOnSelect } from "@/lib/shrinkImage";

export type EventRow = { id: string; title: string; description: string | null; location: string | null; starts_at: string; audience: string; image_path: string | null; status: string };

/** Shows how many e-mails a post would use and how long the daily limit spreads them. */
export function EmailEstimate({ count }: { count: number }) {
  const days = Math.max(1, Math.ceil(count / 100));
  return <span className="text-body-sm text-muted-text">About {count} e-mails{days > 1 ? ` · delivered over ~${days} days (free plan: 100 a day)` : ""}. App and phone notices arrive straight away.</span>;
}

export function EventForm({ event, defaults, counts }: { event?: EventRow; defaults: { date: string; time: string }; counts: { everyone: number; admins: number } }) {
  const [audience, setAudience] = useState(event?.audience ?? "everyone");
  const [email, setEmail] = useState(!event);
  return (
    <ActionForm action={saveEvent} className="space-y-3">
      {event && <input type="hidden" name="id" value={event.id} />}
      <Field label="Title"><input name="title" required maxLength={160} defaultValue={event?.title} placeholder="e.g. Monthly strategy meeting" className="input" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" name="date" required defaultValue={defaults.date} className="input" /></Field>
        <Field label="Time"><input type="time" name="time" required defaultValue={defaults.time} className="input" /></Field>
      </div>
      <Field label="Place or link (optional)"><input name="location" maxLength={300} defaultValue={event?.location ?? ""} placeholder="e.g. Main hall, or a Zoom / Google Meet link" className="input" /></Field>
      <Field label="Details (optional)"><textarea name="description" maxLength={4000} rows={4} defaultValue={event?.description ?? ""} className="input resize-y" placeholder="What it's about, what to bring…" /></Field>
      <Field label="Flyer or photo (optional)"><input type="file" name="image" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={shrinkOnSelect(1600)} className="input file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-on-secondary" /></Field>
      <fieldset>
        <legend className="label">Who should get it</legend>
        <div className="flex flex-wrap gap-4 text-body-md">
          {[["everyone", `Everyone (${counts.everyone})`], ["admins", `Administrators only (${counts.admins})`]].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="audience" value={v} checked={audience === v} onChange={() => setAudience(v)} className="accent-secondary" />{l}</label>
          ))}
        </div>
      </fieldset>
      {!event && (
        <div className="rounded-lg bg-surface-container-low px-3 py-2.5">
          <label className="flex items-center gap-2 text-body-md text-ink"><input type="checkbox" name="email" checked={email} onChange={(e) => setEmail(e.target.checked)} className="h-4 w-4 accent-secondary" />Also send the first notice by e-mail</label>
          <div className="mt-1 pl-6">{email ? <EmailEstimate count={audience === "admins" ? counts.admins : counts.everyone} /> : <span className="text-body-sm text-muted-text">App and phone notifications only.</span>}</div>
        </div>
      )}
      <p className="flex gap-1.5 text-body-sm text-muted-text"><Icon name="notifications_active" className="text-[16px]" />Reminders go out every day at 8 AM until the event, and 1 hour before (app and phone only).</p>
      <div className="flex justify-end"><SubmitButton icon={event ? "save" : "campaign"}>{event ? "Save changes" : "Post event"}</SubmitButton></div>
    </ActionForm>
  );
}
