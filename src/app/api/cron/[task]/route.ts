import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { dispatchNotifications } from "@/server/delivery";
import { ingestServiceUpdates } from "@/server/serviceUpdates";

export const maxDuration = 300;

function authorised(req: NextRequest) {
  const secret = serverEnv().cronSecret;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled processing (Vercel Cron, Supabase pg_cron + pg_net, or any scheduler):
 *   /api/cron/evaluations     – snapshot closed periods, trigger + auto-draw accountability (daily, after midnight)
 *   /api/cron/reminders       – due reminders by schedule (hourly recommended)
 *   /api/cron/dispatch        – deliver pending e-mail / push (every 5–15 min recommended)
 *   /api/cron/service-updates – fetch approved sources, summarise, match (every few hours)
 *   /api/cron/daily           – all of the above (fallback for once-a-day schedulers)
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ task: string }> }) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { task } = await params;
  const db = createAdminClient();
  const result: Record<string, unknown> = {};
  try {
    if (task === "evaluations" || task === "daily") {
      const { data, error } = await db.rpc("cron_run_evaluations");
      if (error) throw error;
      result.evaluations = data;
    }
    if (task === "reminders" || task === "daily") {
      const { data, error } = await db.rpc("cron_run_reminders");
      if (error) throw error;
      result.reminders = data;
    }
    if (task === "service-updates" || task === "daily") result.serviceUpdates = await ingestServiceUpdates();
    if (task === "dispatch" || task === "reminders" || task === "evaluations" || task === "daily") result.dispatch = await dispatchNotifications();
    if (Object.keys(result).length === 0) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
    return NextResponse.json({ ok: true, task, ...result });
  } catch (e) {
    console.error("cron failure", task, e);
    return NextResponse.json({ ok: false, task, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
