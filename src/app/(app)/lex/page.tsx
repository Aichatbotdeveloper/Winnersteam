import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, cn } from "@/components/ui";
import { LexChat, type LexMessage } from "@/components/lex/LexChat";
import { fmtDate } from "@/lib/format";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "LEX Assistant" };

export default async function LexPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const me = await requireUser();
  const { c } = await searchParams;
  const supabase = await createClient();
  const [convs, welcome] = await Promise.all([
    supabase.from("lex_conversations").select("id,title,updated_at").order("updated_at", { ascending: false }).limit(30),
    supabase.from("system_settings").select("value").eq("key", "lex.welcome_message").maybeSingle(),
  ]);
  const active = c && (convs.data ?? []).some((x) => x.id === c) ? c : null;
  const msgs = active ? (await supabase.from("lex_messages").select("role,content,sources,mode").eq("conversation_id", active).order("created_at")).data ?? [] : [];
  const aiOn = Boolean(serverEnv().aiApiKey);
  return (
    <>
      <PageHeader eyebrow="AI & system" title="LEX — Your Platform Assistant"
        description={aiOn ? "Ask how anything in Winners Team works. LEX answers from the approved platform knowledge base and knows your role." : "The AI provider is not configured yet, so LEX answers directly from the platform help centre."} />
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-3">
          <Link href="/lex" className={cn("mb-2 block rounded-lg px-3 py-2 text-label-md", !active ? "bg-secondary text-on-secondary" : "bg-surface-alt text-ink")}>+ New conversation</Link>
          <ul className="space-y-0.5">
            {(convs.data ?? []).map((x) => (
              <li key={x.id}><Link href={`/lex?c=${x.id}`} className={cn("block rounded-lg px-3 py-2 text-body-sm hover:bg-surface-alt", x.id === active && "bg-surface-container-low text-secondary")}>
                <span className="block truncate text-ink">{x.title}</span><span className="text-[11px] text-faint-text">{fmtDate(x.updated_at)}</span></Link></li>
            ))}
          </ul>
        </Card>
        <Card className="flex h-[70vh] min-h-[480px] flex-col overflow-hidden">
          <LexChat key={active ?? "new"} role={me.role} welcome={typeof welcome.data?.value === "string" ? welcome.data.value : "Hi, I'm LEX."}
            initialConversationId={active} initialMessages={msgs as unknown as LexMessage[]} />
        </Card>
      </div>
    </>
  );
}
