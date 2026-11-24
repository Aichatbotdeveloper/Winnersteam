import { beforeAll, describe, expect, it } from "vitest";
import { createAdministrator, createMember, createSuperAdmin, service } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

type Actor = { id: string; email: string; client: SupabaseClient };
let superA: Actor, admin: Actor, otherAdmin: Actor;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let day = 0;
async function fine(member: Actor, amount = 1000) {
  const d = new Date(Date.UTC(2025, 0, 1) + ++day * 86_400_000).toISOString().slice(0, 10);
  const { data: ev, error } = await service.from("accountability_events").insert({
    user_id: member.id, period_type: "daily", period_start: d, period_end: d,
    performance_pct: 40, level: "high", triggering_category: "daily_todo" }).select("id").single();
  if (error) throw error;
  const { data: l, error: e2 } = await service.from("accountability_ledger").insert({
    event_id: ev.id, user_id: member.id, category: "financial_fine", quantity: amount, unit: "NGN", currency: "NGN",
    pool: [], winning_index: 0, selected_by: "system_auto" }).select("id").single();
  if (e2) throw e2;
  return l.id as string;
}
async function receipt(member: Actor) {
  const path = `${member.id}/r-${Date.now()}.png`;
  const { error } = await member.client.storage.from("fine-receipts").upload(path, PNG, { contentType: "image/png" });
  expect(error).toBeNull();
  return path;
}

beforeAll(async () => {
  superA = await createSuperAdmin("fine");
  admin = await createAdministrator(superA.client, "fineadmin");
  otherAdmin = await createAdministrator(superA.client, "fineadmin2");
  await service.from("system_settings").update({ value: true }).eq("key", "fines.payments_enabled");
  await admin.client.rpc("set_payment_details", { p_account_name: "Ade Admin", p_account_number: "8123456789", p_bank_name: "OPay" });
});

describe("fine payments (trial)", () => {
  it("administrators set their account; members of that admin see it, others don't", async () => {
    expect((await admin.client.rpc("set_payment_details", { p_account_name: "Ade Admin", p_account_number: "123", p_bank_name: "OPay" })).error?.message).toMatch(/10 digits/);
    expect((await admin.client.rpc("set_payment_details", { p_account_name: "Ade Admin", p_account_number: "8123456789", p_bank_name: "OPay" })).error).toBeNull();
    const m = await createMember(superA.client, "fine-see", admin.id);
    const other = await createMember(superA.client, "fine-other", otherAdmin.id);
    expect((await m.client.rpc("set_payment_details", { p_account_name: "x x", p_account_number: "8123456789", p_bank_name: "OPay" })).error).not.toBeNull();
    expect((await m.client.from("admin_payment_details").select("account_number")).data).toEqual([{ account_number: "8123456789" }]);
    expect((await other.client.from("admin_payment_details").select("account_number")).data).toEqual([]);
  });

  it("member pays → admin confirms → fine settled; only the payee can confirm; receipts stay private", async () => {
    const m = await createMember(superA.client, "fine-pay", admin.id);
    const ledger = await fine(m);
    // a member cannot just tick their fine as completed while payments are on
    expect((await m.client.rpc("update_ledger_status", { p_ledger: ledger, p_status: "completed" })).error?.message).toMatch(/I've paid/);
    expect((await m.client.rpc("submit_fine_payment", { p_ledger: ledger, p_receipt_path: "someone-else/x.png" })).error?.message).toMatch(/receipt/);
    const path = await receipt(m);
    expect((await m.client.rpc("submit_fine_payment", { p_ledger: ledger, p_receipt_path: path, p_note: "Paid from OPay" })).error).toBeNull();
    expect((await m.client.rpc("submit_fine_payment", { p_ledger: ledger, p_receipt_path: path })).error?.message).toMatch(/already sent/);

    const { data: n } = await service.from("notifications").select("title,email_status").eq("user_id", admin.id).eq("type", "fine.payment_submitted").contains("data", { ledger_id: ledger }).single();
    expect(n!.title).toMatch(/says they paid a ₦1,000 fine/);
    expect(n!.email_status).toBe("skipped");

    // receipts: the payee can open it, another administrator cannot
    expect((await admin.client.storage.from("fine-receipts").createSignedUrl(path, 60)).error).toBeNull();
    expect((await otherAdmin.client.storage.from("fine-receipts").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await otherAdmin.client.rpc("decide_fine_payment", { p_ledger: ledger, p_received: true })).error).not.toBeNull();
    expect((await m.client.rpc("decide_fine_payment", { p_ledger: ledger, p_received: true })).error).not.toBeNull();

    expect((await admin.client.rpc("decide_fine_payment", { p_ledger: ledger, p_received: true })).error).toBeNull();
    const { data: l } = await service.from("accountability_ledger").select("status,completion_note").eq("id", ledger).single();
    expect(l!.status).toBe("completed");
    expect(l!.completion_note).toMatch(/confirmed by/);
    const { data: p } = await service.from("fine_payments").select("status,payee_snapshot").eq("ledger_id", ledger).single();
    expect(p!.status).toBe("confirmed");
    expect(p!.payee_snapshot).toMatchObject({ bank_name: "OPay", account_number: "8123456789" });
  });

  it("'not received' needs a reason, and the member can send again", async () => {
    const m = await createMember(superA.client, "fine-again", admin.id);
    const ledger = await fine(m, 500);
    await m.client.rpc("submit_fine_payment", { p_ledger: ledger, p_receipt_path: await receipt(m) });
    expect((await admin.client.rpc("decide_fine_payment", { p_ledger: ledger, p_received: false })).error?.message).toMatch(/why/);
    expect((await admin.client.rpc("decide_fine_payment", { p_ledger: ledger, p_received: false, p_reason: "Not in my account yet" })).error).toBeNull();
    expect((await service.from("accountability_ledger").select("status").eq("id", ledger).single()).data!.status).toBe("assigned");
    expect((await m.client.rpc("submit_fine_payment", { p_ledger: ledger, p_receipt_path: await receipt(m) })).error).toBeNull();
    expect((await service.from("fine_payments").select("status,reason").eq("ledger_id", ledger).single()).data).toEqual({ status: "submitted", reason: null });
  });

  it("switching the trial off stops new payments", async () => {
    const m = await createMember(superA.client, "fine-off", admin.id);
    const ledger = await fine(m);
    expect((await superA.client.from("system_settings").update({ value: false }).eq("key", "fines.payments_enabled").select()).error).toBeNull();
    expect((await m.client.rpc("submit_fine_payment", { p_ledger: ledger, p_receipt_path: await receipt(m) })).error?.message).toMatch(/switched off/);
    await service.from("system_settings").update({ value: true }).eq("key", "fines.payments_enabled");
  });
});

describe("receipt clean-up", () => {
  it("removes receipts 60 days after a decision and replaced receipts, but never ones awaiting confirmation", async () => {
    const m = await createMember(superA.client, "fine-clean", admin.id);
    const old = await fine(m), waiting = await fine(m), recent = await fine(m), again = await fine(m);
    const pOld = await receipt(m), pWaiting = await receipt(m), pRecent = await receipt(m), pFirst = await receipt(m);
    for (const [l, p] of [[old, pOld], [waiting, pWaiting], [recent, pRecent], [again, pFirst]] as const)
      expect((await m.client.rpc("submit_fine_payment", { p_ledger: l, p_receipt_path: p })).error).toBeNull();
    await admin.client.rpc("decide_fine_payment", { p_ledger: old, p_received: true });
    await admin.client.rpc("decide_fine_payment", { p_ledger: recent, p_received: true });
    await admin.client.rpc("decide_fine_payment", { p_ledger: again, p_received: false, p_reason: "Not seen yet" });
    const pSecond = await receipt(m);
    await m.client.rpc("submit_fine_payment", { p_ledger: again, p_receipt_path: pSecond });
    // the first decision was 61 days ago; the others are recent
    await service.from("fine_payments").update({ decided_at: new Date(Date.now() - 61 * 86_400_000).toISOString() }).eq("ledger_id", old);
    // a long-waiting receipt is still kept
    await service.from("fine_payments").update({ submitted_at: new Date(Date.now() - 90 * 86_400_000).toISOString() }).eq("ledger_id", waiting);

    const { data, error } = await service.rpc("receipts_to_delete", { p_days: 60, p_min_age_minutes: 0 });
    expect(error).toBeNull();
    const paths = new Set((data ?? []).map((r: { path: string }) => r.path));
    expect(paths.has(pOld)).toBe(true);      // decided 61 days ago
    expect(paths.has(pFirst)).toBe(true);    // replaced by "Pay again"
    expect(paths.has(pWaiting)).toBe(false); // still waiting for confirmation
    expect(paths.has(pRecent)).toBe(false);  // decided recently
    expect(paths.has(pSecond)).toBe(false);  // the current, waiting receipt
    // and the default one-day grace protects uploads that haven't been submitted yet
    const fresh = await receipt(m);
    expect(((await service.rpc("receipts_to_delete", {})).data ?? []).some((r: { path: string }) => r.path === fresh)).toBe(false);
    // members cannot call it
    expect((await m.client.rpc("receipts_to_delete", {})).error).not.toBeNull();
  });
});
