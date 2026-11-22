import type { Metadata } from "next";
import { TasksPage } from "@/components/pages/TasksPage";

export const metadata: Metadata = { title: "My Tasks" };

export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  return <TasksPage kind="daily" filter={filter} basePath="/tasks" />;
}
