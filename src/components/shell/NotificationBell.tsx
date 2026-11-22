"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon, cn } from "@/components/ui";
import { timeAgo } from "@/lib/format";

type N = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; category: string };

export function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<N[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  async function load() {
    const { data } = await supabase.from("notifications").select("id,title,body,link,read_at,created_at,category")
      .order("created_at", { ascending: false }).limit(8);
    setItems(data ?? []);
  }

  useEffect(() => {
    // Live updates via Supabase Realtime (RLS-filtered to the current user).
    const channel = supabase.channel(`notif-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
        if (!(p.new as { hidden?: boolean }).hidden) {
          setUnread((u) => u + 1);
          setItems((list) => (list ? [p.new as N, ...list].slice(0, 8) : list));
        }
      }).subscribe();
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", onDoc);
    return () => { supabase.removeChannel(channel); document.removeEventListener("click", onDoc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function markAll() {
    await supabase.rpc("mark_all_notifications_read");
    setUnread(0);
    setItems((l) => l?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? l);
  }

  async function openItem(n: N) {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button aria-label={`Notifications (${unread} unread)`} onClick={() => { setOpen((o) => !o); if (!items) load(); }}
        className="relative rounded-lg p-2 text-muted-text hover:bg-surface-alt hover:text-ink">
        <Icon name="notifications" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-red px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] animate-fade-in overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-float">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <span className="font-heading text-body-lg text-ink">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="text-body-sm font-semibold text-link hover:underline">Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null && <li className="px-4 py-6 text-center text-body-sm text-muted-text">Loading…</li>}
            {items?.length === 0 && <li className="px-4 py-6 text-center text-body-sm text-muted-text">You&apos;re all caught up.</li>}
            {items?.map((n) => (
              <li key={n.id}>
                <Link href={n.link ?? "/notifications"} onClick={() => openItem(n)}
                  className={cn("flex gap-3 border-b border-border-subtle px-4 py-3 hover:bg-surface-alt", !n.read_at && "bg-surface-container-low/60")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-secondary")} />
                  <span className="min-w-0">
                    <span className="block text-label-md text-ink">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-body-sm text-muted-text">{n.body}</span>}
                    <span className="block text-[11px] text-faint-text">{timeAgo(n.created_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block bg-surface-alt px-4 py-2.5 text-center text-body-sm font-semibold text-secondary hover:underline">View all notifications</Link>
        </div>
      )}
    </div>
  );
}
