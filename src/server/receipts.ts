import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Delete fine receipts that are past their keep period (see migration 0021). */
export async function cleanupReceipts(days = 60) {
  const db = createAdminClient();
  const { data, error } = await db.rpc("receipts_to_delete", { p_days: days });
  if (error) return { removed: 0, error: error.message };
  const paths = (data ?? []).map((r: { path: string }) => r.path);
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const r = await db.storage.from("fine-receipts").remove(batch);
    if (r.error) return { removed, error: r.error.message };
    removed += batch.length;
    await db.from("fine_payments").update({ receipt_deleted_at: new Date().toISOString() }).in("receipt_path", batch).is("receipt_deleted_at", null);
  }
  return { removed };
}
