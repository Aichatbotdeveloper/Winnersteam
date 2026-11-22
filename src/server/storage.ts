import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Short-lived signed URL for a private avatar (RLS-checked by Storage). */
export async function avatarUrl(path: string | null | undefined) {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
