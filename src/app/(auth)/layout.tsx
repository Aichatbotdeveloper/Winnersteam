import Link from "next/link";
import { Wordmark } from "@/components/brand/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-border-subtle bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <Link href="/" aria-label="Winners Team home"><Wordmark sub="Productivity · Accountability · Growth" /></Link>
          <nav className="flex items-center gap-1 text-label-md">
            <Link href="/" className="hidden rounded-lg px-3 py-2 text-body-text hover:bg-surface-container-low sm:inline-block">Home</Link>
            <Link href="/login" className="whitespace-nowrap rounded-lg px-3 py-2 text-body-text hover:bg-surface-container-low">Sign in</Link>
            <Link href="/register" className="whitespace-nowrap rounded-lg px-3 py-2 text-body-text hover:bg-surface-container-low">Register</Link>
          </nav>
        </div>
      </header>
      <main className="relative flex-1 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-accent/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-14">{children}</div>
      </main>
      <footer className="border-t border-border-subtle bg-surface-container-low">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-body-sm text-muted-text md:flex-row md:justify-between md:px-8">
          <span>© {new Date().getFullYear()} Winners Team. All rights reserved. · <Link href="/privacy" className="hover:underline">Privacy</Link> · <Link href="/terms" className="hover:underline">Terms</Link></span>
          <span>Need help? Contact your administrator or the Super Admin.</span>
        </div>
      </footer>
    </div>
  );
}
