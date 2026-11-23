import { redirect } from "next/navigation";

// Additional tasks are now items in to-do checklists.
export default function Page() {
  redirect("/tasks");
}
