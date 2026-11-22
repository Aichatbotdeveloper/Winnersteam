import { redirect } from "next/navigation";
import { getCurrentProfile, homeFor } from "@/lib/auth";

export default async function Home() {
  const p = await getCurrentProfile();
  if (!p) redirect("/login");
  if (p.status === "pending" || p.status === "rejected") redirect("/pending-approval");
  redirect(homeFor(p.role));
}
