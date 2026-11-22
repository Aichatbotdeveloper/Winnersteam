import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { AIUnavailableError, getAIProvider } from "@/server/ai/provider";
import { ROLE_LABEL } from "@/lib/labels";

export const maxDuration = 60;

const body = z.object({ conversationId: z.string().uuid().nullable().optional(), message: z.string().trim().min(1).max(1000) });

const MIN_RANK = 0.05;

const SMALL_TALK_REPLY = {
  greeting: "Hello! 👋 I'm LEX. Ask me how anything in Winners Team works — for example \"How do I set my weekly goals?\" or \"How is my score calculated?\"",
  thanks: "You're welcome! Is there anything else you'd like to know about Winners Team?",
  bye: "Goodbye — have a productive day! I'm here whenever you need help.",
} as const;

/** Recognise greetings / thanks / farewells so they aren't treated as help-centre searches. */
function classifySmallTalk(text: string): keyof typeof SMALL_TALK_REPLY | null {
  const t = text.toLowerCase().replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 6) return null;
  if (/^(ok(ay)?|alright|great|cool|nice|perfect|got it)?\s*(thanks?|thank you|thank u|thx|cheers)( (so|very) much| a lot)?( lex)?$|^(ok(ay)?|alright|got it|great|perfect|cool|nice)$/.test(t)) return "thanks";
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|howdy)( there)?( lex)?$/.test(t)) return "greeting";
  if (/^(bye|goodbye|see you|later|good night)( lex)?$/.test(t)) return "bye";
  return null;
}

const ROLE_SCOPE: Record<string, string> = {
  team_member: "The user is a Team Member. Explain their personal workspace: tasks, goals, prospecting, performance, accountability, profile, books, service updates, notifications.",
  administrator: "The user is an Administrator. Explain how to manage their assigned team (monitoring, reports, announcements, removing team members). Administrators cannot transfer members, create administrators or see other teams.",
  super_admin: "The user is the Super Admin. Explain organisation-wide management: registrations, administrators, assignments, settings, audit logs and reports.",
};

export async function POST(req: NextRequest) {
  const me = await getCurrentProfile();
  if (!me || me.status !== "approved") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Message must be 1–1000 characters." }, { status: 400 });
  const supabase = await createClient();

  const { data: lexOn } = await supabase.from("system_settings").select("value").eq("key", "lex.enabled").maybeSingle();
  if (lexOn?.value === false) return NextResponse.json({ error: "LEX is currently disabled by the Super Admin." }, { status: 503 });

  // Conversation (RLS ensures the caller owns it).
  let conversationId = parsed.data.conversationId ?? null;
  if (conversationId) {
    const { data } = await supabase.from("lex_conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!data) conversationId = null;
  }
  // Per-user rate limit: 15 questions per minute.
  const { data: convIds } = await supabase.from("lex_conversations").select("id").eq("user_id", me.id).gte("updated_at", new Date(Date.now() - 60_000).toISOString());
  if (convIds?.length) {
    const { count } = await supabase.from("lex_messages").select("id", { count: "exact", head: true })
      .in("conversation_id", convIds.map((c) => c.id)).eq("role", "user").gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= 15) return NextResponse.json({ error: "You're sending messages too quickly. Please wait a moment." }, { status: 429 });
  }
  if (!conversationId) {
    const { data, error } = await supabase.from("lex_conversations").insert({ title: parsed.data.message.slice(0, 80) }).select("id").single();
    if (error) return NextResponse.json({ error: "Could not start a conversation." }, { status: 500 });
    conversationId = data.id;
  }

  const [kb, history, maxHist] = await Promise.all([
    supabase.rpc("search_knowledge_base", { p_query: parsed.data.message, p_limit: 4 }),
    supabase.from("lex_messages").select("role,content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(24),
    supabase.from("system_settings").select("value").eq("key", "lex.max_history").maybeSingle(),
  ]);
  await supabase.from("lex_messages").insert({ conversation_id: conversationId, role: "user", content: parsed.data.message });

  // Keep only genuinely relevant articles: unrelated text scores ~0, real matches
  // score well above 0.05. Secondary articles must be close to the best match.
  const all = (kb.data ?? []).filter((d) => d.rank >= MIN_RANK);
  const docs = all.filter((d, i) => i === 0 || d.rank >= all[0]!.rank * 0.5).slice(0, 3);
  const sources = docs.slice(0, 2).map((d) => ({ title: d.title, link: d.link }));
  const smallTalk = classifySmallTalk(parsed.data.message);
  const provider = getAIProvider();
  let reply: string; let mode: "ai" | "knowledge_base";

  if (smallTalk && !provider) {
    mode = "knowledge_base";
    reply = SMALL_TALK_REPLY[smallTalk];
    await supabase.from("lex_messages").insert({ conversation_id: conversationId, role: "assistant", content: reply, sources: [], mode });
    await supabase.from("lex_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    return NextResponse.json({ conversationId, reply, sources: [], mode });
  }

  if (provider) {
    const system = [
      "You are LEX, the Winners Team platform assistant. You help people understand and navigate the Winners Team application.",
      ROLE_SCOPE[me.role],
      "Answer ONLY from the platform documentation below. If the documentation does not cover the question, say you don't know and suggest contacting their administrator or the Super Admin. Never invent features, settings or numbers.",
      "Never reveal information about other users, teams or administrators. You have no access to anyone's records.",
      "Be concise and practical: short paragraphs or numbered steps. You may link to pages with markdown links like [Tasks](/tasks).",
      // Only the role is shared with the AI provider — no names or personal records.
      `The user's role is ${ROLE_LABEL[me.role]}.`,
      "<documentation>",
      ...(docs.length ? docs : []).map((d) => `<doc title="${d.title}" link="${d.link ?? ""}">\n${d.content}\n</doc>`),
      "</documentation>",
    ].join("\n");
    const keep = Math.min(Math.max(Number(maxHist.data?.value ?? 12), 0), 24);
    const turns = (history.data ?? []).slice(0, keep).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    try {
      reply = await provider.complete({ system, messages: [...turns, { role: "user", content: parsed.data.message }], maxTokens: 2000, effort: "low" });
      mode = "ai";
    } catch (e) {
      if (!(e instanceof AIUnavailableError)) console.error("LEX provider error", e);
      reply = docs[0] ? `I couldn't reach the AI service just now, but this help article should answer your question:\n\n**${docs[0].title}**\n${docs[0].content}` : "I couldn't reach the AI service just now. Please try again shortly.";
      mode = "knowledge_base";
    }
  } else {
    mode = "knowledge_base";
    reply = docs.length
      ? `Here's what the Winners Team help centre says:\n\n**${docs[0]!.title}**\n${docs[0]!.content}${docs[1] ? `\n\nRelated: **${docs[1].title}**` : ""}`
      : `I couldn't find a help article about that. I can help with things like:\n- How to create your daily to-do list\n- How your performance score is calculated\n- How the accountability wheel works\n- Updating your profile and services\n- Notifications and reminders\n\nTry asking about one of these, or contact your administrator.`;
  }

  await supabase.from("lex_messages").insert({ conversation_id: conversationId, role: "assistant", content: reply.slice(0, 12000), sources, mode });
  await supabase.from("lex_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  return NextResponse.json({ conversationId, reply, sources, mode });
}
