"use client";

import { ActionForm, ConfirmAction, ModalButton, SubmitButton } from "@/components/ui/client";
import { Field } from "@/components/ui";
import { deleteGoal, saveGoal, updateGoalProgress } from "@/server/actions/productivity";

export type Goal = { id: string; title: string; description: string | null; unit: string; target: number; achieved: number; deadline: string };

export function GoalForm({ kind, periodStart, periodEnd, goal }: { kind: "weekly" | "monthly"; periodStart: string; periodEnd: string; goal?: Goal }) {
  return (
    <ActionForm action={saveGoal} resetOnSuccess={!goal} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="period_start" value={periodStart} />
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <Field label="Goal *"><input name="title" required maxLength={200} defaultValue={goal?.title} className="input" placeholder="e.g. Submit client proposals" /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Target *"><input name="target" type="number" required min="0.01" step="any" defaultValue={goal?.target} className="input" /></Field>
        <Field label="Unit"><input name="unit" maxLength={30} defaultValue={goal?.unit ?? "units"} className="input" placeholder="proposals, NGN, calls" /></Field>
        <Field label="Achieved so far"><input name="achieved" type="number" min="0" step="any" defaultValue={goal?.achieved ?? 0} className="input" /></Field>
      </div>
      <Field label="Deadline *" hint={`Must fall within this ${kind === "weekly" ? "week" : "month"}.`}>
        <input name="deadline" type="date" required min={periodStart} max={periodEnd} defaultValue={goal?.deadline ?? periodEnd} className="input" />
      </Field>
      <Field label="Description"><textarea name="description" rows={2} maxLength={2000} defaultValue={goal?.description ?? ""} className="input" /></Field>
      <div className="flex justify-end"><SubmitButton icon="save">{goal ? "Save goal" : "Create goal"}</SubmitButton></div>
    </ActionForm>
  );
}

export function GoalProgress({ kind, goal }: { kind: "weekly" | "monthly"; goal: Goal }) {
  return (
    <ActionForm action={updateGoalProgress} className="flex items-center gap-2" showMessage={false}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={goal.id} />
      <label className="sr-only" htmlFor={`ach-${goal.id}`}>Achieved</label>
      <input id={`ach-${goal.id}`} name="achieved" type="number" min="0" step="any" defaultValue={goal.achieved} className="input w-28 py-1.5" />
      <SubmitButton size="sm" variant="outline" icon="update">Update</SubmitButton>
    </ActionForm>
  );
}

export function GoalActions({ kind, goal, periodStart, periodEnd }: { kind: "weekly" | "monthly"; goal: Goal; periodStart: string; periodEnd: string }) {
  return (
    <div className="flex items-center gap-1">
      <ModalButton label="Edit" title="Edit goal" icon="edit" variant="ghost" size="sm"><GoalForm kind={kind} periodStart={periodStart} periodEnd={periodEnd} goal={goal} /></ModalButton>
      <ConfirmAction action={deleteGoal} label="Delete" icon="delete" variant="ghost" confirm={`Delete "${goal.title}"?`} fields={{ id: goal.id, kind }} />
    </div>
  );
}
