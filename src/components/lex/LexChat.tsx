"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, cn } from "@/components/ui";
import { LexIcon } from "@/components/brand/Logo";

export type LexMessage = { role: "user" | "assistant"; content: string; sources?: { title: string; link: string | null }[]; mode?: string | null };

const SUGGESTIONS: Record<string, string[]> = {
  team_member: ["How do I create my daily to-do list?", "How is my performance calculated?", "How does the accountability wheel work?", "Where can I find my book recommendations?"],
  administrator: ["How do I monitor my team's performance?", "How do I send an announcement to my team?", "Can I remove a team member?", "How is performance calculated?"],
  super_admin: ["How do I approve a pending registration?", "How do I transfer a member to another administrator?", "How do I change the performance weights?", "How do I configure the accountability wheel?"],
};

/** Renders **bold**, `code`, [links](/path) and line breaks safely (no HTML injection). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} className={cn(line.trim() === "" ? "h-2" : "", /^\s*([-*]|\d+\.)\s/.test(line) && "pl-3")}>
          {line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, j) => {
            if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={j}>{part.slice(2, -2)}</strong>;
            if (/^`[^`]+`$/.test(part)) return <code key={j} className="rounded bg-surface-alt px-1 text-[12px]">{part.slice(1, -1)}</code>;
            const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            if (m && m[2]!.startsWith("/")) return <Link key={j} href={m[2]!} className="font-semibold text-link underline">{m[1]}</Link>;
            return <span key={j}>{m ? m[1] : part}</span>;
          })}
        </p>
      ))}
    </>
  );
}

export function LexChat({ role, welcome, initialConversationId = null, initialMessages = [], compact = false }: {
  role: string; welcome: string; initialConversationId?: string | null; initialMessages?: LexMessage[]; compact?: boolean;
}) {
  const [messages, setMessages] = useState<LexMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/lex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, message: q }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "LEX is unavailable right now.");
      setConversationId(data.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: data.reply, sources: data.sources, mode: data.mode }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "LEX is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex-1 space-y-3 overflow-y-auto px-4 py-4", compact ? "" : "md:px-6")}>
        <div className="flex gap-2">
          <LexIcon size={28} />
          <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-surface-alt px-3 py-2 text-body-md text-body-text">{welcome}</div>
        </div>
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 pl-9">
            {(SUGGESTIONS[role] ?? SUGGESTIONS.team_member)!.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-left text-body-sm text-body-text hover:border-secondary hover:text-secondary">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-xl rounded-tr-sm bg-secondary px-3 py-2 text-body-md text-on-secondary">{m.content}</div></div>
        ) : (
          <div key={i} className="flex gap-2">
            <LexIcon size={28} />
            <div className="max-w-[85%] space-y-1 rounded-xl rounded-tl-sm bg-surface-alt px-3 py-2 text-body-md text-body-text">
              <Rich text={m.content} />
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-border-subtle pt-2">
                  {m.sources.map((s) => s.link
                    ? <Link key={s.title} href={s.link} className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-secondary hover:underline">{s.title}</Link>
                    : <span key={s.title} className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted-text">{s.title}</span>)}
                </div>
              )}
              {m.mode === "knowledge_base" && <div className="text-[11px] text-faint-text">Answered from the Winners Team help centre (AI provider not configured).</div>}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 pl-9 text-body-sm text-muted-text"><Icon name="progress_activity" className="animate-spin text-[16px]" />LEX is thinking…</div>}
        {error && <div role="alert" className="ml-9 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">{error}</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-border-subtle p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} placeholder="Ask LEX about the platform…" className="input" aria-label="Message LEX" />
        <button disabled={busy || !input.trim()} className="rounded-lg bg-secondary px-3 text-on-secondary disabled:opacity-50" aria-label="Send"><Icon name="send" /></button>
      </form>
    </div>
  );
}
