"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { homeFor } from "@/lib/auth";
import type { ActionResult } from "@/components/ui/client";

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid e-mail address").max(254);
const passwordSchema = z.string().min(10, "Password must be at least 10 characters").max(72)
  .regex(/[A-Za-z]/, "Password must contain a letter").regex(/[0-9]/, "Password must contain a number");

function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : null;
}

export async function signIn(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password") })
    .safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    if (error?.message.toLowerCase().includes("email not confirmed")) {
      redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
    }
    return { ok: false, message: error?.message.toLowerCase().includes("banned") ? "This account has been deactivated." : "Invalid e-mail or password." };
  }
  const { data: profile } = await supabase.from("profiles").select("role,status").eq("id", data.user.id).single();
  if (!profile) return { ok: false, message: "Profile not found." };
  if (profile.status === "pending" || profile.status === "rejected") redirect("/pending-approval");
  if (profile.status !== "approved") {
    await supabase.auth.signOut();
    return { ok: false, message: "This account is no longer active. Contact the Super Admin." };
  }
  // Pick and record this login's motivational quote; the shell displays it.
  await supabase.rpc("next_login_quote");
  const next = safeNext(fd.get("next"));
  redirect(`${next ?? homeFor(profile.role)}${(next ?? "").includes("?") ? "&" : "?"}welcome=1`);
}

const registerSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(120),
  email: emailSchema,
  phone: z.string().trim().max(40).regex(/^[+0-9 ()-]*$/, "Phone number contains invalid characters").optional(),
  job_title: z.string().trim().max(120).optional(),
  team_name: z.string().trim().max(120).optional(),
  team_leader_name: z.string().trim().max(120).optional(),
  requested_specialisation: z.string().trim().max(200).optional(),
  password: passwordSchema,
  confirm: z.string(),
  consent: z.literal("on", { message: "Please confirm the information is accurate" }),
}).refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export async function register(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(["full_name", "email", "phone", "job_title", "team_name", "team_leader_name", "requested_specialisation", "password", "confirm", "consent"]
    .map((k) => [k, fd.get(k) ?? undefined]));
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };

  // Registration can be closed by the Super Admin (setting read server-side).
  const admin = createAdminClient();
  const { data: open } = await admin.from("system_settings").select("value").eq("key", "registration.open").maybeSingle();
  if (open && open.value === false) return { ok: false, message: "Registration is currently closed. Please contact the office." };

  const { password, confirm: _c, consent: _k, email, ...meta } = parsed.data;
  void _c; void _k;
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: meta, emailRedirectTo: `${env.siteUrl}/auth/callback?next=/pending-approval` },
  });
  if (error) return { ok: false, message: error.message.includes("registered") ? "An account with this e-mail already exists." : error.message };
  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}

export async function resendVerification(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = emailSchema.safeParse(fd.get("email"));
  if (!email.success) return { ok: false, message: "Enter a valid e-mail address" };
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email: email.data, options: { emailRedirectTo: `${env.siteUrl}/auth/callback?next=/pending-approval` } });
  return error ? { ok: false, message: error.message } : { ok: true, message: "If the account exists and is unverified, a new e-mail has been sent." };
}

export async function forgotPassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = emailSchema.safeParse(fd.get("email"));
  if (!email.success) return { ok: false, message: "Enter a valid e-mail address" };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${env.siteUrl}/auth/callback?next=/reset-password` });
  // Same response whether or not the account exists (no account enumeration).
  return { ok: true, message: "If an account exists for that address, a password-reset link has been sent." };
}

export async function updatePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ password: passwordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Passwords do not match" })
    .safeParse({ password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: error.message };
  const { data: profile } = await supabase.from("profiles").select("role,status").eq("id", u.user.id).single();
  if (profile?.status === "approved") {
    await supabase.rpc("next_login_quote");
    redirect(`${homeFor(profile.role)}?welcome=1`);
  }
  redirect("/pending-approval");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
