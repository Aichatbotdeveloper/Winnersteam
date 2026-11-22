import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/labels";
import { todayInOrg } from "@/lib/format";
import { navFor } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";
import { WelcomeQuote } from "@/components/shell/WelcomeQuote";
import { LexLauncher } from "@/components/lex/LexLauncher";
import { Toaster } from "@/components/ui/client";
import { avatarUrl } from "@/server/storage";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireUser();
  const supabase = await createClient();
  const [unread, categories, quote, pending, lexSettings] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("task_categories").select("id,name,kind").eq("active", true).order("name"),
    supabase.rpc("latest_quote"),
    profile.role === "super_admin"
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    supabase.from("system_settings").select("key,value").in("key", ["lex.enabled", "lex.welcome_message"]),
    supabase.rpc("touch_last_seen"),
  ]);
  const settings = Object.fromEntries((lexSettings.data ?? []).map((s) => [s.key, s.value]));
  const roleLabel = ROLE_LABEL[profile.role];

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar sections={navFor(profile.role)} roleLabel={roleLabel} userName={profile.full_name} pendingCount={pending.count ?? 0} />
      <div className="lg:pl-72">
        <Header user={{ id: profile.id, full_name: profile.full_name, email: profile.email, roleLabel }}
          unread={unread.count ?? 0} categories={(categories.data ?? []) as never} today={todayInOrg()} avatarUrl={await avatarUrl(profile.avatar_path)} />
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-6 md:px-6">{children}</main>
      </div>
      <Suspense>
        <WelcomeQuote quote={quote.data?.[0] ?? null} firstName={profile.full_name.split(" ")[0] ?? profile.full_name} />
      </Suspense>
      <Toaster />
      <LexLauncher role={profile.role} enabled={settings["lex.enabled"] !== false}
        welcome={typeof settings["lex.welcome_message"] === "string" ? settings["lex.welcome_message"] : "Hi, I'm LEX — your Winners Team platform assistant."} />
    </div>
  );
}
