import { SiteHeader } from "@/components/landing/SiteHeader";
import { getCurrentProfile } from "@/lib/auth";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { CookieBanner } from "@/components/landing/CookieBanner";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentProfile();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader solid signedIn={Boolean(me && me.status === "approved")} />
      <main className="flex-1 pt-16 md:pt-20">
        <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20 [&>h1]:font-heading [&>h1]:text-3xl [&>h1]:font-bold [&>h1]:tracking-tight [&>h1]:text-ink md:[&>h1]:text-4xl [&>h2]:mt-10 [&>h2]:font-heading [&>h2]:text-xl [&>h2]:font-bold [&>h2]:text-ink [&>ul>li]:mt-1.5 [&>p]:mt-4 [&>p]:leading-relaxed [&>p]:text-muted-text [&>ul]:mt-4 [&>ul]:list-disc [&>ul]:space-y-1 [&>ul]:pl-6 [&>ul]:text-muted-text">
          {children}
        </article>
      </main>
      <SiteFooter />
      <FeedbackButton />
      <CookieBanner />
    </div>
  );
}
