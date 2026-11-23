import type { Metadata } from "next";
import { ChecklistsPage } from "@/components/pages/ChecklistsPage";

export const metadata: Metadata = { title: "Weekly Goals" };

export default function Page() {
  return <ChecklistsPage kind="weekly" />;
}
