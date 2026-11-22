"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, cn } from "@/components/ui";
import { LexIcon } from "@/components/brand/Logo";
import { LexChat } from "./LexChat";

const STORAGE_KEY = "wt:lex-chat";

/**
 * Floating LEX window. Minimising only hides it: the conversation (including a
 * reply still being written) stays alive, and it is kept for the browser
 * session so it survives page changes and refreshes. "New chat" starts over.
 */
export function LexLauncher({ role, welcome, enabled }: { role: string; welcome: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [unread, setUnread] = useState(false);
  const pathname = usePathname();
  if (!enabled) return null;
  const onLexPage = pathname === "/lex";

  function toggle() {
    setStarted(true);
    setOpen((o) => !o);
    setUnread(false);
  }
  function newChat() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setChatKey((k) => k + 1);
  }

  return (
    <div className={cn("no-print", onLexPage && "hidden")}>
      {started && (
        <div className={cn("fixed bottom-20 right-4 z-50 flex h-[min(600px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-float",
          open ? "animate-fade-in" : "hidden")} role="dialog" aria-label="LEX assistant" aria-hidden={!open}>
          <div className="flex items-center justify-between bg-primary px-4 py-3 text-on-primary">
            <div className="flex items-center gap-2">
              <LexIcon size={30} />
              <div className="leading-tight"><div className="font-heading text-body-lg">LEX</div><div className="text-[11px] text-faint-text">Your Platform Assistant</div></div>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={newChat} className="rounded p-1 text-faint-text hover:text-on-primary" aria-label="Start a new chat" title="New chat"><Icon name="add_comment" className="text-[19px]" /></button>
              <Link href="/lex" onClick={() => setOpen(false)} className="rounded p-1 text-faint-text hover:text-on-primary" aria-label="Open full LEX page" title="Open full page"><Icon name="open_in_full" className="text-[18px]" /></Link>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-faint-text hover:text-on-primary" aria-label="Minimise LEX (keeps your chat)" title="Minimise"><Icon name="remove" /></button>
            </div>
          </div>
          <LexChat key={chatKey} role={role} welcome={welcome} compact persistKey={STORAGE_KEY} onReply={() => setUnread((u) => u || !document.querySelector('[aria-label="LEX assistant"]:not([aria-hidden="true"])'))} />
        </div>
      )}
      <button onClick={toggle} className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl bg-primary py-2 pl-2 pr-3.5 text-label-md text-on-primary shadow-float ring-1 ring-white/10 hover:bg-primary-container" aria-expanded={open}>
        <span className="relative"><LexIcon size={28} /><span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-primary", unread ? "bg-accent-amber" : "bg-accent")} /></span>
        {open ? "Minimise LEX" : unread ? "LEX replied" : "LEX Assistant"}
      </button>
    </div>
  );
}
