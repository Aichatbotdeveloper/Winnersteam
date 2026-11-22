"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverSoon } from "@/server/deliverSoon";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import type { ActionResult } from "@/components/ui/client";

export type SpinResult = {
  ok: boolean; message?: string;
  ledger_id?: string; category?: string; quantity?: number; unit?: string; currency?: string | null;
  winning_index?: number; sectors?: { option_id: string; category: string; quantity: number; unit: string; weight: number }[];
  accommodation?: boolean; status?: string;
};

/**
 * The server (Postgres, inside one transaction) selects, records and assigns
 * the outcome. The browser only animates to the returned index. Repeated calls
 * return the same result — there are no rerolls and no approval step.
 */
export async function spinAccountability(eventId: string): Promise<SpinResult> {
  try {
    deliverSoon();
    await assertUser(["team_member"]);
    const id = z.string().uuid().parse(eventId);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("spin_accountability", { p_event: id });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/accountability");
    revalidatePath("/dashboard");
    return { ok: true, ...(data as object) } as SpinResult;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Spin failed" };
  }
}

export async function updateLedger(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const id = z.string().uuid().parse(fd.get("id"));
    const status = z.enum(["assigned", "in_progress", "completed"]).parse(fd.get("status"));
    const note = z.string().trim().max(1000).optional().parse(fd.get("note") ?? undefined) || null;
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_ledger_status", { p_ledger: id, p_status: status, p_note: note ?? undefined });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/accountability");
    return { ok: true, message: status === "completed" ? "Marked as completed" : "Status updated" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function setAccommodation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const enabled = fd.get("enabled") === "true";
    const note = z.string().trim().max(500).optional().parse(fd.get("note") || undefined) ?? null;
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_physical_accommodation", { p_enabled: enabled, p_note: note ?? undefined });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/accountability");
    return { ok: true, message: enabled ? "Physical accommodation is ON — physical activities are excluded from your wheel." : "Physical accommodation is OFF." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Update failed" };
  }
}
