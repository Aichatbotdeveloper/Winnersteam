import type { Metadata } from "next";
import { TasksPage } from "@/components/pages/TasksPage";

export const metadata: Metadata = { title: "Additional Tasks" };

export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  return <TasksPage kind="additional" filter={filter} basePath="/additional-tasks" />;
}
