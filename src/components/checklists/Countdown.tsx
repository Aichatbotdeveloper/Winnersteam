"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

// One shared ticking clock (updates every 15 s) for all countdowns on the page.
let now = 0;
const subs = new Set<() => void>();
let timer: number | undefined;
function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    now = Date.now();
    timer = window.setInterval(() => { now = Date.now(); subs.forEach((s) => s()); }, 15_000);
  }
  return () => { subs.delete(cb); if (!subs.size) { window.clearInterval(timer); timer = undefined; } };
}
const getNow = () => now || Date.now();

export function useNow() {
  return useSyncExternalStore(subscribe, getNow, () => 0);
}

export function remaining(ms: number) {
  if (ms <= 0) return "closing…";
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m left`;
  return `${Math.floor(h / 24)} days left`;
}

/** "2h 13m left"; refreshes the page once the deadline passes so it is graded. */
export function Countdown({ deadline, className }: { deadline: string; className?: string }) {
  const t = useNow();
  const router = useRouter();
  const ms = new Date(deadline).getTime() - t;
  const fired = useRef(false);
  useEffect(() => {
    if (!t || ms > 0 || fired.current) return;
    fired.current = true;
    const id = window.setTimeout(() => router.refresh(), 1500); // give the server a moment to grade
    return () => window.clearTimeout(id);
  }, [t, ms, router]);
  // Precise refresh at the deadline itself (the shared clock only ticks every 15 s).
  useEffect(() => {
    const left = new Date(deadline).getTime() - Date.now();
    if (left <= 0 || left > 2 ** 31 - 1) return;
    const id = window.setTimeout(() => router.refresh(), left + 1500);
    return () => window.clearTimeout(id);
  }, [deadline, router]);
  if (!t) return null;
  return <span className={className}>{remaining(ms)}</span>;
}
