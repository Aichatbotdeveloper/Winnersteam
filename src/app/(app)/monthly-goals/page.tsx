import type { Metadata } from "next";
import { GoalsPage } from "@/components/pages/GoalsPage";

export const metadata: Metadata = { title: "Monthly Goals" };

export default function Page() {
  return <GoalsPage kind="monthly" />;
}
