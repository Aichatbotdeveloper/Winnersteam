import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { CookieBanner } from "./CookieBanner";
import hero from "@/assets/landing/hero-team.webp";
import community from "@/assets/landing/community.webp";
import celebration from "@/assets/landing/celebration.webp";
import ceoPortrait from "@/assets/landing/ceo-portrait.webp";
import ceoSpeaking from "@/assets/landing/ceo-speaking.webp";

const Q = 90; // image quality (allowed in next.config images.qualities)

const STEPS = [
  { icon: "event_note", title: "Plan", text: "Start each day with a clear to-do list and set weekly and monthly goals that move you forward." },
  { icon: "bolt", title: "Act", text: "Follow up on prospects, complete your tasks and log your progress as you go." },
  { icon: "monitoring", title: "Measure", text: "Your performance score shows exactly where you’re winning and where to push harder." },
  { icon: "trending_up", title: "Grow", text: "Recommended books, industry updates for your services, and LEX, your AI assistant, help you keep improving." },
];

const JOIN = [
  { title: "Sign up", text: "Create your account with your name and email." },
  { title: "Confirm your email", text: "Click the link we send you." },
  { title: "Get approved", text: "Our team reviews your registration." },
  { title: "Start winning", text: "You’re matched with an administrator and your workspace is ready." },
];

function Eyebrow({ children, tone = "purple" }: { children: React.ReactNode; tone?: "purple" | "emerald" }) {
  return (
    <p className={`mb-3 text-xs font-semibold uppercase tracking-[0.18em] ${tone === "emerald" ? "text-accent" : "text-secondary"}`}>
      {children}
    </p>
  );
}

function JoinButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/register"
      className={`inline-flex items-center justify-center gap-2 rounded-md bg-secondary px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-secondary/30 transition-colors hover:bg-secondary-container ${className}`}
    >
      Join the team
      <span className="material-symbols-outlined text-[20px]" aria-hidden>arrow_forward</span>
    </Link>
  );
}

export function Landing() {
  return (
    <div className="bg-canvas text-body-text">
      <SiteHeader />

      <main>
        {/* Hero ------------------------------------------------------------ */}
        <section className="relative flex min-h-[100svh] items-end overflow-hidden bg-ink sm:min-h-[640px] md:min-h-[760px] lg:h-[92vh] lg:max-h-[960px]">
          {/* Phones: photo fills the top part so faces stay clear of the text. Larger screens: full bleed. */}
          <div className="absolute inset-x-0 top-0 h-[62%] sm:h-full">
            <Image
              src={hero}
              alt="Members of Winners Team together at an event"
              fill
              preload
              quality={Q}
              sizes="100vw"
              placeholder="blur"
              className="object-cover object-[50%_25%]"
            />
            {/* Overlays keep the faces visible at the top and the text readable at the bottom. */}
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/10 sm:via-ink/70" aria-hidden />
            <div className="absolute inset-0 hidden bg-gradient-to-r from-ink/70 via-transparent to-transparent sm:block" aria-hidden />
          </div>

          <div className="relative mx-auto w-full max-w-6xl px-4 pb-12 pt-[52vw] sm:px-6 sm:pt-32 md:pb-20">
            <div className="max-w-2xl">
              <Eyebrow tone="emerald">Winners Team</Eyebrow>
              <h1 className="font-heading text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Where ambition becomes achievement.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/85 md:text-xl">
                Winners Team is a community of people who plan with purpose, act with discipline and grow together every day.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <JoinButton />
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-md border border-white/30 bg-white/5 px-6 py-3.5 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/15"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* About ----------------------------------------------------------- */}
        <section id="about" className="scroll-mt-20 bg-white py-20 md:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <Eyebrow>About Winners Team</Eyebrow>
              <h2 className="font-heading text-3xl font-bold tracking-tight text-ink md:text-4xl">
                Built for people who refuse to stand still
              </h2>
              <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-text md:text-lg">
                <p>
                  Winners Team brings together students, entrepreneurs and self-employed people who want more from every day.
                  Whether you’re studying for a degree, building a business, or looking for more streams of income, you’ll find
                  people here who share your drive.
                </p>
                <p>
                  We believe success isn’t luck. It’s the result of clear goals, consistent action and honest accountability.
                  That’s why every member gets a personal workspace to plan their days, set weekly and monthly goals, track
                  prospecting and see real progress in their own performance score.
                </p>
                <p className="font-semibold text-ink">Anyone can join. If you’re ready to grow, there’s a place for you here.</p>
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-3 -z-0 rounded-2xl bg-secondary/10 md:-inset-4" aria-hidden />
              <Image
                src={community}
                alt="Winners Team members standing together outdoors"
                quality={Q}
                sizes="(min-width: 1024px) 560px, 100vw"
                placeholder="blur"
                className="relative aspect-[4/3] w-full rounded-xl object-cover shadow-xl"
              />
            </div>
          </div>
        </section>

        {/* How it works ---------------------------------------------------- */}
        <section id="how-it-works" className="scroll-mt-20 bg-surface-container-low py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="font-heading text-3xl font-bold tracking-tight text-ink md:text-4xl">Your daily system for winning</h2>
            </div>
            <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-xl border border-border-subtle bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-white">
                      <span className="material-symbols-outlined text-[26px]" aria-hidden>{s.icon}</span>
                    </span>
                    <span className="font-heading text-3xl font-bold text-surface-dim" aria-hidden>0{i + 1}</span>
                  </div>
                  <h3 className="mt-5 font-heading text-xl font-bold text-ink">{s.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted-text">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Culture --------------------------------------------------------- */}
        <section className="bg-white py-20 md:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <Image
              src={celebration}
              alt="Members celebrating a win with confetti"
              quality={Q}
              sizes="(min-width: 1024px) 560px, 100vw"
              placeholder="blur"
              className="aspect-[3/2] w-full rounded-xl object-cover shadow-xl lg:order-1"
            />
            <div className="lg:order-2">
              <Eyebrow>We celebrate wins</Eyebrow>
              <h2 className="font-heading text-3xl font-bold tracking-tight text-ink md:text-4xl">A culture of wins, big and small</h2>
              <p className="mt-6 text-base leading-relaxed text-muted-text md:text-lg">
                At Winners Team, progress is noticed and celebrated. We cheer each other on, hold each other accountable and keep
                raising the bar together. When one of us wins, we all win.
              </p>
            </div>
          </div>
        </section>

        {/* CEO ------------------------------------------------------------- */}
        <section id="ceo" className="relative scroll-mt-20 overflow-hidden bg-ink py-20 text-white md:py-28">
          <div className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-accent/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-40 -left-40 h-[480px] w-[480px] rounded-full bg-secondary/20 blur-3xl" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[5fr_6fr] lg:gap-16">
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <Image
                src={ceoPortrait}
                alt="Gabriel Samuel, Founder and CEO of Winners Team"
                quality={Q}
                sizes="(min-width: 1024px) 460px, (min-width: 640px) 448px, 100vw"
                placeholder="blur"
                className="aspect-[4/5] w-full rounded-xl object-cover shadow-2xl ring-1 ring-white/10"
              />
              <Image
                src={ceoSpeaking}
                alt="Gabriel Samuel speaking at a Winners Team event"
                quality={Q}
                sizes="200px"
                placeholder="blur"
                className="absolute -bottom-8 -right-3 hidden aspect-[2/3] w-36 rounded-lg object-cover shadow-2xl ring-4 ring-ink sm:block md:-right-8 md:w-44"
              />
            </div>
            <div className="mt-4 lg:mt-0">
              <Eyebrow tone="emerald">Meet our CEO — An Emerald Director</Eyebrow>
              <h2 className="font-heading text-4xl font-bold tracking-tight text-white md:text-5xl">Gabriel Samuel</h2>
              <p className="mt-2 text-lg font-medium text-accent">Founder &amp; CEO</p>
              <div className="mt-6 h-px w-16 bg-accent" aria-hidden />
              <div className="mt-6 space-y-4 text-base leading-relaxed text-white/80 md:text-lg">
                <p>
                  Gabriel Samuel is a student and business owner who believes no one should have to choose between learning and
                  earning. He founded Winners Team to help people like him (students, young entrepreneurs and the self-employed)
                  build discipline, grow their networks and turn ambition into real results.
                </p>
                <p>
                  Gabriel is passionate about impacting lives and connecting people. He believes the right community can change
                  the direction of a person’s life, and he leads Winners Team with that belief at its heart.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How to join ----------------------------------------------------- */}
        <section id="join" className="scroll-mt-20 bg-canvas py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow>How to join</Eyebrow>
              <h2 className="font-heading text-3xl font-bold tracking-tight text-ink md:text-4xl">Joining takes four simple steps</h2>
            </div>
            <ol className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {JOIN.map((s, i) => (
                <li key={s.title} className="relative text-center">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ink font-heading text-xl font-bold text-white ring-8 ring-secondary/10">
                    {i + 1}
                  </span>
                  <h3 className="mt-5 font-heading text-lg font-bold text-ink">{s.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted-text">{s.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-14 text-center">
              <JoinButton />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <CookieBanner />
    </div>
  );
}
