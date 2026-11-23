"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

/**
 * Cookie notice for the public website. The site only sets essential cookies
 * (sign-in session), so "Essential only" turns off optional cookies — none
 * exist today; any future analytics must check `cookieConsent() === "all"`.
 */
const KEY = "wt:cookie-consent";
const EVENT = "wt:cookie-consent";
export type CookieConsent = "all" | "essential";

export function cookieConsent(): CookieConsent | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// Server render / before hydration: treat as "decided" so the banner never flashes.
const getServer = () => "decided";
const getClient = () => cookieConsent() ?? "undecided";

export function CookieBanner() {
  const state = useSyncExternalStore(subscribe, getClient, getServer);
  if (state !== "undecided") return null;

  const choose = (v: CookieConsent) => {
    try {
      window.localStorage.setItem(KEY, v);
    } catch {
      /* storage blocked: banner simply closes for this page view */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <div role="region" aria-label="Cookie notice" className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 rounded-xl border border-white/10 bg-ink/95 p-5 text-white shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:gap-6">
        <div className="flex gap-3">
          <span className="material-symbols-outlined mt-0.5 shrink-0 text-[22px] text-accent" aria-hidden>cookie</span>
          <p className="text-sm leading-relaxed text-white/85">
            We use essential cookies to keep you signed in and secure. We don’t use advertising or tracking cookies.{" "}
            <Link href="/privacy#cookies" className="font-semibold text-white underline underline-offset-2 hover:text-accent">Read more</Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("essential")}
            className="flex-1 whitespace-nowrap rounded-md border border-white/25 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:flex-none">
            Essential only
          </button>
          <button type="button" onClick={() => choose("all")}
            className="flex-1 whitespace-nowrap rounded-md bg-secondary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-secondary-container sm:flex-none">
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

/** Footer link that clears the saved choice so the banner shows again. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
        window.dispatchEvent(new Event(EVENT));
      }}
    >
      Cookie settings
    </button>
  );
}
