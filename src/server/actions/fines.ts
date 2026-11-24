"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import { deliverSoon } from "@/server/deliverSoon";
import type { ActionResult } from "@/components/ui/client";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong" });

/** Administrator: the account members pay fines into. */
export async function savePaymentDetails(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["administrator"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_payment_details", {
      p_account_name: String(fd.get("account_name") ?? ""), p_account_number: String(fd.get("account_number") ?? "").replace(/\s/g, ""),
      p_bank_name: String(fd.get("bank_name") ?? "") });
    if (error) return fail(error);
    revalidatePath("/profile");
    return { ok: true, message: "Payment details saved. Your team members will see them when they have a fine to pay." };
  } catch (e) { return fail(e); }
}

const RECEIPT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/** Member: "I've paid" with a receipt (image or PDF, up to 5 MB). */
export async function submitFinePayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    const me = await assertUser(["team_member"]);
    const ledger = z.string().uuid().parse(fd.get("ledger_id"));
    const file = fd.get("receipt");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Upload a screenshot or PDF of your payment receipt." };
    if (!RECEIPT[file.type]) return { ok: false, message: "Use a PNG, JPEG or WebP image, or a PDF." };
    if (file.size > 5 * 1024 * 1024) return { ok: false, message: "The receipt must be 5 MB or smaller." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ok = (bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0xff && bytes[1] === 0xd8)
      || (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
      || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
    if (!ok) return { ok: false, message: "That file doesn't look like an image or PDF." };
    const supabase = await createClient();
    const path = `${me.id}/${ledger}-${Date.now()}.${RECEIPT[file.type]}`;
    const up = await supabase.storage.from("fine-receipts").upload(path, bytes, { contentType: file.type, upsert: false });
    if (up.error) return fail(up.error);
    const note = String(fd.get("note") ?? "").trim().slice(0, 500) || undefined;
    const { error } = await supabase.rpc("submit_fine_payment", { p_ledger: ledger, p_receipt_path: path, p_note: note });
    if (error) { await supabase.storage.from("fine-receipts").remove([path]); return fail(error); }
    revalidatePath("/accountability");
    return { ok: true, message: "Sent. Your administrator will confirm once they see the payment." };
  } catch (e) { return fail(e); }
}

/** Administrator (payee) or Super Admin: confirm, or "not received" with a reason. */
export async function decideFinePayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    await assertUser(["administrator", "super_admin"]);
    const ledger = z.string().uuid().parse(fd.get("ledger_id"));
    const received = fd.get("decision") === "received";
    const supabase = await createClient();
    const { error } = await supabase.rpc("decide_fine_payment", { p_ledger: ledger, p_received: received, p_reason: String(fd.get("reason") ?? "").trim() || undefined });
    if (error) return fail(error);
    revalidatePath("/accountability");
    return { ok: true, message: received ? "Payment confirmed — the fine is settled." : "Marked as not received. The member has been told." };
  } catch (e) { return fail(e); }
}

/** Super Admin: switch the trial on or off. */
export async function setFinePaymentsEnabled(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const on = fd.get("enabled") === "on";
    const supabase = await createClient();
    const { error } = await supabase.from("system_settings").update({ value: on }).eq("key", "fines.payments_enabled");
    if (error) return fail(error);
    revalidatePath("/settings/accountability"); revalidatePath("/accountability");
    return { ok: true, message: on ? "Fine payments switched on." : "Fine payments switched off." };
  } catch (e) { return fail(e); }
}
