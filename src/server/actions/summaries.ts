"use server";

import { revalidatePath } from "next/cache";
import { assertUser } from "@/lib/auth";
import { generateDueSummaries } from "@/server/summaries";
import type { ActionResult } from "@/components/ui/client";

/** Super Admin: create the due summaries now (normally automatic on Monday / the 1st at 7 AM). */
export async function createSummariesNow(_prev: ActionResult): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const r = await generateDueSummaries(50_000);
    revalidatePath("/summaries");
    const pending = (r.weekly_pending ?? 0) + (r.monthly_pending ?? 0);
    return { ok: true, message: `Created ${(r.weekly ?? 0) + (r.monthly ?? 0)} summaries.${pending ? ` ${pending} more will be created automatically in the next few minutes.` : ""}` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Could not create summaries" }; }
}
