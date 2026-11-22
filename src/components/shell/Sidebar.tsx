"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, cn } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import type { NavSection } from "./nav";

export function Sidebar({ sections, roleLabel, userName, pendingCount }: { sections: NavSection[]; roleLabel: string; userName: string; pendingCount: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const h = () => setOpen((o) => !o);
    window.addEventListener("wt:toggle-sidebar", h);
    return () => window.removeEventListener("wt:toggle-sidebar", h);
  }, []);

  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const isActive = (href: string) =>
    pathname === href || (pathname.startsWith(href + "/") && !allHrefs.some((h) => h !== href && h.startsWith(href + "/") && pathname.startsWith(h)));

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={cn("no-print fixed left-0 top-0 z-50 flex h-full w-72 flex-col bg-primary text-on-primary shadow-float transition-transform lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full")} aria-label="Main navigation">
        <div className="flex items-center justify-between bg-primary-container px-4 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <LogoMark size={30} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-label-md text-on-primary">Winners Team</div>
              <div className="truncate text-label-sm text-faint-text">{roleLabel} Workspace</div>
            </div>
          </Link>
          <button className="rounded p-1 text-faint-text hover:text-on-primary lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation"><Icon name="close" /></button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4 scrollbar-none">
          {sections.map((s) => (
            <div key={s.title} className="space-y-0.5">
              <div className="px-2 py-1 text-label-sm uppercase tracking-wider text-faint-text">{s.title}</div>
              {s.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-2 rounded-lg px-2 py-2 text-[14px] transition-colors",
                      active ? "bg-secondary font-semibold text-on-secondary" : "font-medium text-faint-text hover:bg-primary-container hover:text-on-primary")}>
                    <Icon name={item.icon} className="text-[19px]" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badgeKey === "pending" && pendingCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-amber px-1 text-[11px] font-bold text-primary">{pendingCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-primary-container px-3 py-3 text-[11px]">
          <div className="flex items-center gap-1.5 text-faint-text"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Connected to Supabase</div>
          <div className="mt-1 flex items-center justify-between font-mono text-on-primary-container"><span className="truncate">{userName}</span><span className="text-accent">{roleLabel.toUpperCase()}</span></div>
        </div>
      </aside>
    </>
  );
}
