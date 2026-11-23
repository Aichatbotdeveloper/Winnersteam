import type { Metadata } from "next";
import { ChecklistsPage } from "@/components/pages/ChecklistsPage";

export const metadata: Metadata = { title: "My To-Do Checklists" };

export default function Page() {
  return <ChecklistsPage kind="todo" />;
}
