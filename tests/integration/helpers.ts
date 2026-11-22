import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error("Integration tests need NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (local stack).");
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const service = createClient(SUPABASE_URL, SERVICE_KEY, opts);

export const PASSWORD = "Test-Password-123!";
const run = Date.now().toString(36);
export const email = (tag: string) => `${tag}.${run}@test.winners-team.local`;

export async function signIn(addr: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY, opts);
  const { error } = await c.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw new Error(`sign in ${addr}: ${error.message}`);
  return c;
}

export async function createAuthUser(addr: string, meta: Record<string, unknown> = {}) {
  const { data, error } = await service.auth.admin.createUser({
    email: addr, password: PASSWORD, email_confirm: true, user_metadata: meta,
  });
  if (error) throw new Error(`create ${addr}: ${error.message}`);
  return data.user!.id;
}

export async function createSuperAdmin(tag = "super") {
  const addr = email(tag);
  const id = await createAuthUser(addr, { full_name: "Super Admin Test" });
  const { error } = await service.rpc("bootstrap_super_admin", { p_email: addr });
  if (error) throw error;
  return { id, email: addr, client: await signIn(addr) };
}

export async function createAdministrator(superClient: SupabaseClient, tag: string) {
  const addr = email(tag);
  const { error } = await superClient.rpc("create_admin_invitation", { p_email: addr, p_full_name: `Admin ${tag}` });
  if (error) throw error;
  const id = await createAuthUser(addr);
  return { id, email: addr, client: await signIn(addr) };
}

export async function createMember(superClient: SupabaseClient, tag: string, adminId: string) {
  const addr = email(tag);
  const id = await createAuthUser(addr, { full_name: `Member ${tag}`, job_title: "Analyst" });
  const { error } = await superClient.rpc("approve_registration", { p_member: id, p_admin: adminId });
  if (error) throw error;
  return { id, email: addr, client: await signIn(addr) };
}

export async function orgToday(): Promise<string> {
  const { data, error } = await service.rpc("org_today");
  if (error) throw error;
  return data as string;
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
