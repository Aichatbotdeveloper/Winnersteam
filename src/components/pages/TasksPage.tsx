import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, PageHeader, Progress, StatTile, Tabs } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { TaskList, type TaskItem } from "@/components/tasks/TaskList";
import { TaskForm } from "@/components/tasks/TaskForm";
import { addDays, fmtDate, nowTimeInOrg, pct, todayInOrg } from "@/lib/format";

const FILTERS = [
  { key: "today", label: "Today", icon: "today" },
  { key: "upcoming", label: "Upcoming", icon: "event_upcoming" },
  { key: "overdue", label: "Overdue", icon: "alarm" },
  { key: "completed", label: "Completed", icon: "task_alt" },
  { key: "history", label: "History", icon: "history" },
];

export async function TasksPage({ kind, filter: rawFilter, basePath }: { kind: "daily" | "additional"; filter?: string; basePath: string }) {
  const me = await requireUser();
  const filter = FILTERS.some((f) => f.key === rawFilter) ? rawFilter! : "today";
  const today = todayInOrg();
  const now = nowTimeInOrg();
  const supabase = await createClient();

  let q = supabase.from("tasks").select("*, category:task_categories(name,color)").eq("owner_id", me.id).eq("kind", kind).is("deleted_at", null);
  if (filter === "today") q = q.eq("due_date", today);
  if (filter === "upcoming") q = q.gt("due_date", today);
  if (filter === "overdue") q = q.eq("due_date", today).neq("status", "completed").not("due_time", "is", null).lt("due_time", now);
  if (filter === "completed") q = q.eq("status", "completed").gte("due_date", addDays(today, -30));
  if (filter === "history") q = q.lt("due_date", today).gte("due_date", addDays(today, -30));
  const [list, todays, cats] = await Promise.all([
    q.order("due_date", { ascending: filter !== "history" && filter !== "completed" }).order("due_time", { nullsFirst: false }).limit(300),
    supabase.from("tasks").select("status").eq("owner_id", me.id).eq("kind", kind).eq("due_date", today).is("deleted_at", null),
    supabase.from("task_categories").select("id,name,kind").eq("active", true).order("name"),
  ]);
  const t = todays.data ?? [];
  const done = t.filter((x) => x.status === "completed").length;
  const rate = t.length ? (done / t.length) * 100 : null;
  const items = (list.data ?? []) as unknown as TaskItem[];
  const label = kind === "daily" ? "daily to-do" : "additional task";

  // Group history by date
  const groups = new Map<string, TaskItem[]>();
  for (const it of items) groups.set(it.due_date, [...(groups.get(it.due_date) ?? []), it]);

  return (
    <>
      <PageHeader eyebrow="Productivity & execution" title={kind === "daily" ? "My Tasks & Daily To-Dos" : "Additional Tasks"}
        description={kind === "daily"
          ? "Plan, complete and track your daily to-do list. Completion = completed tasks ÷ total tasks due today."
          : "Responsibilities beyond your standard to-do list (office support, training, events…). They count toward the Additional Tasks weight."}
        actions={<ModalButton label={`New ${label}`} title={`New ${label}`} icon="add"><TaskForm categories={(cats.data ?? []) as never} today={today} defaultKind={kind} /></ModalButton>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Due today" value={t.length} icon="today" />
        <StatTile label="Completed today" value={done} icon="task_alt" tone="green" />
        <StatTile label="Still pending" value={t.length - done} icon="pending_actions" tone="amber" />
        <div className="card p-4">
          <div className="eyebrow">Today&apos;s completion</div>
          <div className="mt-2 font-heading text-[28px] font-bold leading-none text-ink">{pct(rate)}</div>
          <Progress value={rate ?? 0} className="mt-3" />
        </div>
      </div>
      <Card className="p-5">
        <Tabs active={filter} items={FILTERS.map((f) => ({ ...f, href: `${basePath}?filter=${f.key}` }))} />
        {filter === "history" || filter === "completed" ? (
          groups.size === 0 ? <EmptyState icon="history" title="Nothing here yet">Completed and past tasks from the last 30 days appear here.</EmptyState> : (
            <div className="space-y-5">
              {[...groups.entries()].map(([date, rows]) => (
                <div key={date}>
                  <div className="mb-1 flex items-center gap-2 text-label-md text-ink">{fmtDate(date, { weekday: "long", day: "numeric", month: "short" })}
                    <Badge>{rows.filter((r) => r.status === "completed").length}/{rows.length} completed</Badge>
                    {date < today && <Badge tone="neutral">Locked · evaluated</Badge>}
                  </div>
                  <TaskList tasks={rows} today={today} categories={(cats.data ?? []) as never} nowTime={now} />
                </div>
              ))}
            </div>
          )
        ) : (
          <TaskList tasks={items} today={today} categories={(cats.data ?? []) as never} nowTime={now}
            empty={<EmptyState icon={filter === "overdue" ? "celebration" : "add_task"} title={filter === "overdue" ? "No overdue tasks" : `No ${label}s ${filter === "upcoming" ? "scheduled ahead" : "for today"}`}>
              {filter === "today" ? <>Use <strong>New {label}</strong> to plan your day.</> : null}
            </EmptyState>} />
        )}
        <p className="mt-4 border-t border-border-subtle pt-3 text-body-sm text-faint-text">
          Closed days are locked because they have already been evaluated. Need a correction? Contact the Super Admin. <Link href="/performance" className="font-semibold text-secondary">See how scoring works →</Link>
        </p>
      </Card>
    </>
  );
}
