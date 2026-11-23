"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { THEME_EVENT, THEME_KEY } from "./themeScript";

type Pref = "light" | "dark" | "system";
const OPTIONS: { value: Pref; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "contrast" },
];

function readPref(): Pref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(THEME_EVENT, cb); window.removeEventListener("storage", cb); };
}
// The resolved theme lives on <html data-theme>; watch it so the icon matches the page.
function subscribeResolved(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** Light / Dark / System switch. `tone="onDark"` for placement on the dark public-site header. */
export function ThemeToggle({ tone = "default" }: { tone?: "default" | "onDark" }) {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as Pref);
  const resolved = useSyncExternalStore(subscribeResolved,
    () => document.documentElement.getAttribute("data-theme") ?? "light", () => "light");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const choose = (v: Pref) => {
    try {
      if (v === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v);
    } catch { /* storage blocked: still apply for this page */
      document.documentElement.setAttribute("data-theme",
        v === "dark" || (v === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
    }
    window.dispatchEvent(new Event(THEME_EVENT));
    setOpen(false);
  };

  const btn = tone === "onDark"
    ? "text-white/85 hover:bg-white/10 hover:text-white"
    : "text-muted-text hover:bg-surface-container-low hover:text-ink";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${btn}`}
        aria-label={`Theme: ${pref === "system" ? "System" : pref === "dark" ? "Dark" : "Light"}. Change theme`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Light or dark mode"
      >
        <span className="material-symbols-outlined text-[22px]" aria-hidden>{resolved === "dark" ? "dark_mode" : "light_mode"}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Theme" className="absolute right-0 z-[70] mt-2 w-40 overflow-hidden rounded-xl border border-border-subtle bg-surface py-1 shadow-float">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={pref === o.value}
              onClick={() => choose(o.value)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-md transition-colors hover:bg-surface-container-low ${pref === o.value ? "font-semibold text-secondary" : "text-body-text"}`}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden>{o.icon}</span>
              {o.label}
              {pref === o.value && <span className="material-symbols-outlined ml-auto text-[18px]" aria-hidden>check</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
