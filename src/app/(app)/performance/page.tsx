import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PerformanceView } from "@/components/performance/PerformanceView";

export const metadata: Metadata = { title: "My Performance" };

export default async function Page({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const me = await requireUser();
  const { period } = await searchParams;
  const p = (["daily", "weekly", "monthly"].includes(period ?? "") ? period : "daily") as "daily" | "weekly" | "monthly";
  return (
    <>
      <PageHeader eyebrow="Telemetry engine" title="My Performance" description="Your weighted achievement score, category breakdown and recorded history." />
      <PerformanceView userId={me.id} period={p} basePath="/performance" />
    </>
  );
}
