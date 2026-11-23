import Image from "next/image";
import Link from "next/link";

const LINKS = [
  ["About", "/#about"],
  ["How it works", "/#how-it-works"],
  ["Our CEO", "/#ceo"],
  ["Sign in", "/login"],
  ["Join", "/register"],
  ["Privacy Policy", "/privacy"],
  ["Terms", "/terms"],
] as const;

export function SiteFooter() {
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/brand/winners-team-logo-512.png" alt="" width={44} height={44} className="h-11 w-11" />
            <div>
              <p className="font-heading text-lg font-bold">Winners Team</p>
              <p className="text-sm text-white/60">Where ambition becomes achievement</p>
            </div>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3">
            {LINKS.map(([label, href]) => (
              <Link key={href} href={href} className="text-sm text-white/70 transition-colors hover:text-white">{label}</Link>
            ))}
          </nav>
        </div>
        <p className="mt-10 border-t border-white/10 pt-6 text-sm text-white/50">
          © {new Date().getFullYear()} Winners Team. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
