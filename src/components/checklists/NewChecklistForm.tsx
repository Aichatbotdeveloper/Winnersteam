"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { createChecklist } from "@/server/actions/checklists";
import { KIND, type ChecklistKind } from "@/lib/checklists";

export function NewChecklistForm({ kind, defaultDeadline }: { kind: ChecklistKind; defaultDeadline: string }) {
  const [rows, setRows] = useState(() => [0, 1, 2]);
  const [date, time] = defaultDeadline.split("T");
  const prospecting = kind === "prospecting";
  return (
    <ActionForm action={createChecklist} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <label className="block">
        <span className="label">Title</span>
        <input name="title" required maxLength={120} autoFocus placeholder="Give this checklist a name" className="input" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Deadline date</span><input type="date" name="deadline_date" defaultValue={date} required className="input" /></label>
        <label className="block"><span className="label">Time</span><input type="time" name="deadline_time" defaultValue={time} required className="input" /></label>
      </div>
      <fieldset>
        <legend className="label">{prospecting ? "Targets" : "Items"} <span className="font-normal text-muted-text">(you can add more later)</span></legend>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r} className="flex gap-2">
              <input name="item_title" maxLength={200} placeholder={i === 0 ? KIND[kind].itemPlaceholder : `Item ${i + 1}`} aria-label={`Item ${i + 1}`} className="input min-w-0 flex-1" />
              {prospecting && <input name="item_target" type="number" min={1} placeholder="Target" aria-label={`Target for item ${i + 1}`} className="input w-24" />}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((x) => [...x, Math.max(...x) + 1])} className="mt-2 inline-flex items-center gap-1 text-body-sm font-semibold text-secondary">
          <Icon name="add" className="text-[18px]" />Add another
        </button>
      </fieldset>
      <p className="rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-muted-text">
        Mark each item {prospecting ? "with how many you have done" : "0%, 25%, 50%, 75% or 100%"} as you work. The checklist is graded at its deadline, or when you press Submit now.
        A deadline can be moved earlier, but not later.
      </p>
      <div className="flex justify-end"><SubmitButton icon="add">Create checklist</SubmitButton></div>
    </ActionForm>
  );
}
