import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
      <LogoMark size={64} />
      <h1 className="font-heading text-display-lg-mobile text-ink">Page not found</h1>
      <p className="max-w-md text-body-md text-muted-text">This page doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/" className="rounded-lg bg-primary px-4 py-2 text-label-md text-on-primary">Back to Winners Team</Link>
    </main>
  );
}
