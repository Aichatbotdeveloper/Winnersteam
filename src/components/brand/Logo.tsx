import Image from "next/image";
import { cn } from "@/components/ui";

/** Official Winners Team trophy logo (supplied artwork). */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return <Image src="/brand/winners-team-logo-512.png" alt="Winners Team logo" width={size} height={size} className={cn("shrink-0 rounded-lg object-cover", className)} priority />;
}

export function Wordmark({ dark = false, sub }: { dark?: boolean; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={36} />
      <div className="leading-tight">
        <div className={cn("font-heading text-[17px] font-bold tracking-tight", dark ? "text-on-primary" : "text-ink")}>Winners Team</div>
        {sub && <div className={cn("text-label-sm uppercase tracking-wider", dark ? "text-faint-text" : "text-muted-text")}>{sub}</div>}
      </div>
    </div>
  );
}

/** LEX assistant icon — an original mark derived from the trophy logo. */
export function LexIcon({ size = 24, className }: { size?: number; className?: string }) {
  return <Image src="/brand/lex-icon.svg" alt="" width={size} height={size} className={cn("shrink-0", className)} />;
}
