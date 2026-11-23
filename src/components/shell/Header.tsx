"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar, Icon } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { NewChecklistForm } from "@/components/checklists/NewChecklistForm";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { signOut } from "@/app/(auth)/actions";

export function Header({ user, unread, defaultDeadline, avatarUrl }: {
  user: { id: string; full_name: string; email: string; roleLabel: string };
  unread: number; defaultDeadline: string; avatarUrl: string | null;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);

  return (
    <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-border-subtle bg-surface/95 px-3 py-2.5 backdrop-blur md:px-6">
      <button className="rounded-lg p-2 text-muted-text hover:bg-surface-alt lg:hidden" aria-label="Open navigation"
        onClick={() => window.dispatchEvent(new Event("wt:toggle-sidebar"))}><Icon name="menu" /></button>
      <form action="/search" className="relative max-w-md flex-1">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-faint-text" />
        <input name="q" placeholder="Search tasks, goals, members…" aria-label="Search" className="w-full rounded-lg border border-border-subtle bg-surface-alt py-2 pl-9 pr-3 text-body-sm focus:border-secondary focus:bg-surface focus:outline-none" />
      </form>
      <div className="ml-auto flex items-center gap-1.5">
        <ModalButton label={<span className="hidden sm:inline">New checklist</span>} title="New to-do checklist" icon="add" size="sm" className="py-2">
          <NewChecklistForm kind="todo" defaultDeadline={defaultDeadline} />
        </ModalButton>
        <ThemeToggle />
        <NotificationBell userId={user.id} initialUnread={unread} />
        <div className="relative" ref={ref}>
          <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-alt" aria-haspopup="menu" aria-expanded={menu}>
            <span className="hidden items-center gap-1.5 rounded-md bg-surface-container-low px-2 py-1 text-[11px] font-semibold text-secondary md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary" />{user.roleLabel}
            </span>
            <Avatar name={user.full_name} src={avatarUrl} size={32} />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 mt-2 w-64 animate-fade-in overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-float">
              <div className="border-b border-border-subtle px-4 py-3">
                <div className="truncate text-label-md text-ink">{user.full_name}</div>
                <div className="truncate text-body-sm text-muted-text">{user.email}</div>
              </div>
              <Link role="menuitem" href="/profile" className="flex items-center gap-2 px-4 py-2 text-body-md hover:bg-surface-alt"><Icon name="badge" className="text-[18px]" />My profile</Link>
              <Link role="menuitem" href="/notifications?tab=preferences" className="flex items-center gap-2 px-4 py-2 text-body-md hover:bg-surface-alt"><Icon name="tune" className="text-[18px]" />Preferences</Link>
              <form action={signOut}><button role="menuitem" className="flex w-full items-center gap-2 px-4 py-2 text-left text-body-md text-accent-red hover:bg-surface-alt"><Icon name="logout" className="text-[18px]" />Sign out</button></form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
