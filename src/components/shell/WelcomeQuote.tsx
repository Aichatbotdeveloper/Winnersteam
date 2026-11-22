"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui";

export type Quote = { text: string; author: string; source: string | null; category: string } | null;

/** Shows the motivational quote chosen at sign-in (recorded server-side). */
export function WelcomeQuote({ quote, firstName }: { quote: Quote; firstName: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (params.get("welcome") === "1" && quote) setOpen(true); }, [params, quote]);

  function close() {
    setOpen(false);
    const sp = new URLSearchParams(params.toString());
    sp.delete("welcome");
    router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false });
  }
  if (!open || !quote) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onClick={close}>
      <div className="w-full max-w-lg animate-fade-in rounded-xl bg-surface p-7 shadow-float" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="rounded-md bg-surface-container-low px-2 py-1 text-label-sm uppercase tracking-wider text-secondary">Today&apos;s motivation · {quote.category.replace("_", " ")}</span>
          <button onClick={close} aria-label="Close" className="rounded p-1 text-muted-text hover:bg-surface-alt"><Icon name="close" /></button>
        </div>
        <h2 id="welcome-title" className="mt-5 font-heading text-heading-md text-ink">Welcome back, {firstName}!</h2>
        <blockquote className="mt-3 border-l-4 border-secondary pl-4">
          <p className="font-heading text-[22px] leading-snug text-ink">“{quote.text}”</p>
          <footer className="mt-2 text-body-md text-muted-text">— {quote.author}{quote.source ? <span className="text-faint-text">, {quote.source}</span> : null}</footer>
        </blockquote>
        <button onClick={close} className="mt-6 w-full rounded-lg bg-primary py-2.5 text-label-md text-on-primary hover:bg-primary-container">Let&apos;s get to work</button>
      </div>
    </div>
  );
}
