import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Role = Database["public"]["Enums"]["app_role"];

/** The signed-in user's profile, read through RLS (never from client input). */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  return data ?? null;
});

/**
 * Guard for server components / actions. Redirects according to account state;
 * RLS remains the authoritative enforcement layer underneath.
 */
export async function requireUser(roles?: Role[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.status === "pending" || profile.status === "rejected") redirect("/pending-approval");
  if (profile.status !== "approved") redirect("/login?error=inactive");
  if (roles && !roles.includes(profile.role)) redirect(homeFor(profile.role));
  return profile;
}

export function homeFor(role: Role) {
  return role === "super_admin" ? "/super-admin" : role === "administrator" ? "/admin" : "/dashboard";
}

/** For server actions: returns the profile or throws (no redirect side effects). */
export async function assertUser(roles?: Role[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || profile.status !== "approved") throw new Error("Your session has expired or your account is not active.");
  if (roles && !roles.includes(profile.role)) throw new Error("You are not authorised to perform this action.");
  return profile;
}
