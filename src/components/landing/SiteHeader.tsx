"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

export const SITE_NAV = [
  ["About", "/#about"],
  ["How it works", "/#how-it-works"],
  ["Our CEO", "/#ceo"],
] as const;

/** Public-site header: transparent over the hero, solid once the page scrolls (or always, with `solid`). */
export function SiteHeader({ solid = false }: { solid?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (solid) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [solid]);

  const filled = solid || scrolled || open;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        filled ? "border-b border-white/10 bg-ink/95 backdrop-blur" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 md:h-20">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <Image src="/brand/winners-team-logo-512.png" alt="" width={40} height={40} className="h-9 w-9 md:h-10 md:w-10" />
          <span className="font-heading text-lg font-bold tracking-tight text-white md:text-xl">Winners Team</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {SITE_NAV.map(([label, href]) => (
            <Link key={href} href={href} className="text-sm font-medium text-white/80 transition-colors hover:text-white">
              {label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className="rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10">
            Sign in
          </Link>
          <Link href="/register" className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-secondary/30 transition-colors hover:bg-secondary-container">
            Join the team
          </Link>
        </div>

        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 md:hidden"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="material-symbols-outlined" aria-hidden>{open ? "close" : "menu"}</span>
        </button>
      </div>

      {open && (
        <div id="site-menu" className="border-t border-white/10 bg-ink px-4 pb-6 pt-2 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col">
            {SITE_NAV.map(([label, href]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)} className="border-b border-white/10 py-3.5 text-base font-medium text-white/90">
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link href="/login" className="rounded-md border border-white/25 py-3 text-center text-sm font-semibold text-white">Sign in</Link>
            <Link href="/register" className="rounded-md bg-secondary py-3 text-center text-sm font-semibold text-white">Join the team</Link>
          </div>
        </div>
      )}
    </header>
  );
}
