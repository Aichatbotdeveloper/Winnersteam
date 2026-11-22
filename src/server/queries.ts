import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type PeriodType = Database["public"]["Enums"]["period_type"];
export type PerfCategory = Database["public"]["Enums"]["perf_category"];
export type CategoryScore = {
  category: PerfCategory; applicable: boolean; completed: number; total: number;
  raw_pct: number | null; capped_pct: number | null; weight: number; effective_weight: number;
};
export type Performance = {
  overall: number | null; period_type: PeriodType; period_start: string; period_end: string;
  weights: Record<PerfCategory, number>; categories: CategoryScore[];
};

export function normalisePerformance(raw: unknown): Performance {
  const r = raw as Record<string, unknown>;
  const cats = ((r.categories as Record<string, unknown>[]) ?? []).map((c) => ({
    category: c.category as PerfCategory, applicable: Boolean(c.applicable),
    completed: Number(c.completed ?? 0), total: Number(c.total ?? 0),
    raw_pct: c.raw_pct === null || c.raw_pct === undefined ? null : Number(c.raw_pct),
    capped_pct: c.capped_pct === null || c.capped_pct === undefined ? null : Number(c.capped_pct),
    weight: Number(c.weight ?? 0), effective_weight: Number(c.effective_weight ?? 0),
  }));
  const order: PerfCategory[] = ["daily_todo", "weekly_goals", "prospecting", "monthly_goals", "additional_tasks"];
  cats.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return {
    overall: r.overall === null || r.overall === undefined ? null : Number(r.overall),
    period_type: r.period_type as PeriodType, period_start: String(r.period_start), period_end: String(r.period_end),
    weights: r.weights as Record<PerfCategory, number>, categories: cats,
  };
}

export async function getPerformance(userId: string, type: PeriodType, date?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_performance", { p_user: userId, p_type: type, p_date: date });
  if (error) throw new Error(error.message);
  return normalisePerformance(data);
}

export async function getOrgToday() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("org_today");
  return data as string;
}
