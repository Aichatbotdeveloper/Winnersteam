"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field } from "@/components/ui";
import { createTask, updateTask } from "@/server/actions/productivity";

export type TaskCategory = { id: string; name: string; kind: "daily" | "additional" };
export type TaskRow = {
  id: string; title: string; description: string | null; notes: string | null; kind: "daily" | "additional";
  category_id: string | null; priority: "low" | "normal" | "high" | "urgent"; due_date: string; due_time: string | null;
};

export function TaskForm({ categories, today, task, defaultKind = "daily", onDone }: {
  categories: TaskCategory[]; today: string; task?: TaskRow; defaultKind?: "daily" | "additional"; onDone?: () => void;
}) {
  const kind = task?.kind ?? defaultKind;
  return (
    <ActionForm action={task ? updateTask : createTask} resetOnSuccess={!task} onSuccess={() => onDone?.()} className="space-y-4">
      {task && <input type="hidden" name="id" value={task.id} />}
      <Field label="Title *"><input name="title" required maxLength={200} defaultValue={task?.title} className="input" autoFocus /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="List">
          <select name="kind" defaultValue={kind} className="input">
            <option value="daily">Daily to-do list</option>
            <option value="additional">Additional task</option>
          </select>
        </Field>
        <Field label="Category">
          <select name="category_id" defaultValue={task?.category_id ?? ""} className="input">
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.kind === "additional" ? " (additional)" : ""}</option>)}
          </select>
        </Field>
        <Field label="Due date *"><input name="due_date" type="date" required min={today} defaultValue={task?.due_date ?? today} className="input" /></Field>
        <Field label="Due time"><input name="due_time" type="time" defaultValue={task?.due_time?.slice(0, 5) ?? ""} className="input" /></Field>
        <Field label="Priority" className="sm:col-span-2">
          <select name="priority" defaultValue={task?.priority ?? "normal"} className="input">
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea name="description" rows={2} maxLength={2000} defaultValue={task?.description ?? ""} className="input" /></Field>
      <Field label="Notes"><textarea name="notes" rows={2} maxLength={4000} defaultValue={task?.notes ?? ""} className="input" /></Field>
      <div className="flex justify-end"><SubmitButton icon={task ? "save" : "add"}>{task ? "Save changes" : "Create task"}</SubmitButton></div>
    </ActionForm>
  );
}
