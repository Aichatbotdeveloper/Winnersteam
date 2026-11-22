"use client";

import { useActionState, useEffect, useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Icon, cn } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { PRIORITY_STYLE } from "@/lib/labels";
import { deleteTask, setTaskStatus } from "@/server/actions/productivity";
import { TaskForm, type TaskCategory, type TaskRow } from "./TaskForm";

export type TaskItem = TaskRow & { status: "pending" | "in_progress" | "completed"; completed_at: string | null; category?: { name: string; color: string } | null };

function TaskLine({ t, today, categories, readOnly, nowTime }: { t: TaskItem; today: string; categories: TaskCategory[]; readOnly: boolean; nowTime: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(t.status);
  const [delState, delAction] = useActionState(deleteTask, null);
  useEffect(() => { if (delState?.ok) router.refresh(); }, [delState, router]);
  const locked = t.due_date < today;
  const done = optimistic === "completed";
  const overdue = !done && (t.due_date < today || (t.due_date === today && t.due_time !== null && t.due_time.slice(0, 5) < nowTime));

  function toggle() {
    const next = done ? "pending" : "completed";
    start(async () => {
      setOptimistic(next);
      const fd = new FormData();
      fd.set("id", t.id); fd.set("status", next);
      const r = await setTaskStatus(null, fd);
      if (!r?.ok) alert(r?.message);
      router.refresh();
    });
  }

  return (
    <li className={cn("flex items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-border-subtle hover:bg-surface-alt/60", done && "bg-surface-alt/40")}>
      <button onClick={toggle} disabled={readOnly || locked || pending} aria-label={done ? `Mark "${t.title}" pending` : `Mark "${t.title}" completed`}
        className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
          done ? "border-primary bg-primary text-white" : "border-border-strong bg-surface hover:border-secondary", (readOnly || locked) && "cursor-not-allowed opacity-60")}>
        {done && <Icon name="check" className="text-[14px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("text-body-md font-medium text-ink", done && "text-muted-text line-through")}>{t.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-body-sm text-muted-text">
          {t.category && <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: t.category.color, background: `${t.category.color}14` }}>{t.category.name}</span>}
          {t.kind === "additional" && <Badge tone="blue">Additional</Badge>}
          <span className={cn("flex items-center gap-0.5", overdue && "text-accent-red")}>
            <Icon name={overdue ? "alarm" : "schedule"} className="text-[14px]" />
            {t.due_date !== today ? t.due_date : "Today"}{t.due_time ? ` · ${t.due_time.slice(0, 5)}` : ""}{overdue ? " · overdue" : ""}
          </span>
          {t.description && <span className="hidden truncate md:inline">· {t.description}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {done ? <Badge tone="green"><Icon name="check" className="text-[12px]" />Completed</Badge> : <Badge tone={overdue ? "red" : "amber"} dot>{overdue ? "Overdue" : "Pending"}</Badge>}
        <span className={cn("hidden rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize sm:inline", PRIORITY_STYLE[t.priority])}>{t.priority}</span>
        {!readOnly && !locked && (
          <>
            <ModalButton label={<Icon name="edit" className="text-[16px]" />} title="Edit task" variant="ghost" size="sm" className="px-1.5">
              {(close) => <TaskForm categories={categories} today={today} task={t} onDone={close} />}
            </ModalButton>
            <form action={delAction} onSubmit={(e) => { if (!confirm(`Delete "${t.title}"?`)) e.preventDefault(); }}>
              <input type="hidden" name="id" value={t.id} />
              <button className="rounded-lg p-1.5 text-muted-text hover:bg-error-container hover:text-accent-red" aria-label={`Delete ${t.title}`}><Icon name="delete" className="text-[16px]" /></button>
            </form>
          </>
        )}
        {locked && <Icon name="lock" className="text-[16px] text-faint-text" />}
      </div>
    </li>
  );
}

export function TaskList({ tasks, today, categories, readOnly = false, nowTime, empty }: {
  tasks: TaskItem[]; today: string; categories: TaskCategory[]; readOnly?: boolean; nowTime: string; empty?: React.ReactNode;
}) {
  if (tasks.length === 0) return <>{empty}</>;
  return <ul className="space-y-1">{tasks.map((t) => <TaskLine key={t.id} t={t} today={today} categories={categories} readOnly={readOnly} nowTime={nowTime} />)}</ul>;
}
