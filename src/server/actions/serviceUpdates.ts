"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import type { ActionResult } from "@/components/ui/client";

export async function markUpdate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await assertUser();
  const id = z.string().uuid().parse(fd.get("id"));
  const op = z.enum(["read", "unread", "save", "unsave"]).parse(fd.get("op"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_service_update", {
    p_update: id, p_read: op === "read" ? true : op === "unread" ? false : undefined, p_saved: op === "save" ? true : op === "unsave" ? false : undefined,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/service-updates");
  return { ok: true, message: "Updated" };
}
