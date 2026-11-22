"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui";
import { LexIcon } from "@/components/brand/Logo";
import { LexChat } from "./LexChat";

export function LexLauncher({ role, welcome, enabled }: { role: string; welcome: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (!enabled || pathname === "/lex") return null;
  return (
    <div className="no-print">
      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex h-[min(600px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] animate-fade-in flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-float" role="dialog" aria-label="LEX assistant">
          <div className="flex items-center justify-between bg-primary px-4 py-3 text-on-primary">
            <div className="flex items-center gap-2">
              <LexIcon size={30} />
              <div className="leading-tight"><div className="font-heading text-body-lg">LEX</div><div className="text-[11px] text-faint-text">Your Platform Assistant</div></div>
            </div>
            <div className="flex items-center gap-1">
              <Link href="/lex" className="rounded p-1 text-faint-text hover:text-on-primary" aria-label="Open full LEX page"><Icon name="open_in_full" className="text-[18px]" /></Link>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-faint-text hover:text-on-primary" aria-label="Close LEX"><Icon name="close" /></button>
            </div>
          </div>
          <LexChat role={role} welcome={welcome} compact />
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl bg-primary py-2 pl-2 pr-3.5 text-label-md text-on-primary shadow-float ring-1 ring-white/10 hover:bg-primary-container" aria-expanded={open}>
        <span className="relative"><LexIcon size={28} /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-primary" /></span>
        LEX Assistant
      </button>
    </div>
  );
}
