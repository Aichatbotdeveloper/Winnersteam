"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field } from "@/components/ui";
import { logProspecting, saveProspectingTargets } from "@/server/actions/productivity";
import { PROSPECTING_LABEL } from "@/lib/labels";

const ACTIVITIES = Object.keys(PROSPECTING_LABEL) as (keyof typeof PROSPECTING_LABEL)[];

export function TargetsForm({ period, periodStart, current, suggestion }: { period: "daily" | "weekly"; periodStart: string; current: Record<string, number>; suggestion?: Record<string, number> }) {
  return (
    <ActionForm action={saveProspectingTargets} className="space-y-3">
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="period_start" value={periodStart} />
      <p className="text-body-sm text-muted-text">Leave an activity at 0 for no target. {period === "weekly" ? "A weekly target replaces the daily targets for that activity in the weekly assessment (never counted twice)." : ""}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {ACTIVITIES.map((a) => (
          <Field key={a} label={PROSPECTING_LABEL[a]}>
            <input name={`target_${a}`} type="number" min={0} max={10000} step={1} defaultValue={current[a] ?? suggestion?.[a] ?? 0} className="input" />
          </Field>
        ))}
      </div>
      {suggestion && Object.keys(current).length === 0 && Object.keys(suggestion).length > 0 && <p className="text-body-sm text-secondary">Prefilled from your most recent targets — save to apply.</p>}
      <div className="flex justify-end"><SubmitButton icon="save">Save {period} targets</SubmitButton></div>
    </ActionForm>
  );
}

export function LogActivityForm() {
  return (
    <ActionForm action={logProspecting} resetOnSuccess className="grid gap-3 md:grid-cols-[1.3fr_0.6fr_1.2fr_auto] md:items-end">
      <Field label="Activity">
        <select name="activity" className="input" defaultValue="contact_prospects">
          {ACTIVITIES.map((a) => <option key={a} value={a}>{PROSPECTING_LABEL[a]}</option>)}
        </select>
      </Field>
      <Field label="Quantity"><input name="quantity" type="number" min={1} max={1000} defaultValue={1} required className="input" /></Field>
      <Field label="Prospect / note (optional)"><input name="prospect_name" maxLength={160} className="input" placeholder="Company or contact" /></Field>
      <SubmitButton icon="add" className="h-[38px]">Log</SubmitButton>
    </ActionForm>
  );
}
