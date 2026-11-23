"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, cn } from "@/components/ui";

/** Round floating "Talk to the developer" button (bottom-left, opposite LEX). */
export function FeedbackButton({ inApp = false }: { inApp?: boolean }) {
  const path = usePathname();
  if (path === "/feedback") return null;
  return (
    <Link href={`/feedback?from=${encodeURIComponent(path)}`} aria-label="Talk to the developer: send feedback"
      className={cn("no-print group fixed bottom-4 left-4 z-40 flex h-12 items-center sm:h-14 rounded-full bg-gradient-to-br from-secondary to-accent-purple text-white shadow-[0_8px_24px_rgba(90,69,203,0.45)] ring-4 ring-white/70 transition-all duration-300 hover:from-accent hover:to-accent-emerald hover:shadow-[0_8px_28px_rgba(30,215,96,0.45)] focus-visible:ring-accent dark:ring-white/10 lg:bottom-6", inApp ? "lg:left-[calc(18rem+1.5rem)]" : "lg:left-6")}>
      <span className="relative flex h-12 w-12 shrink-0 sm:h-14 sm:w-14 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-secondary/40 motion-reduce:hidden group-hover:hidden" aria-hidden style={{ animationDuration: "2.4s" }} />
        <Icon name="forum" fill className="relative text-[26px]" />
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap pr-0 text-label-md font-semibold opacity-0 transition-all duration-300 group-hover:max-w-56 group-hover:pr-5 group-hover:opacity-100 group-focus-visible:max-w-56 group-focus-visible:pr-5 group-focus-visible:opacity-100">
        Talk to the developer
      </span>
    </Link>
  );
}
