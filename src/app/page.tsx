import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile, homeFor } from "@/lib/auth";
import { Landing } from "@/components/landing/Landing";

const DESCRIPTION = "Winners Team is a community of people who plan with purpose, act with discipline and grow together every day. Anyone can join.";

export const metadata: Metadata = {
  title: { absolute: "Winners Team — Where ambition becomes achievement" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", siteName: "Winners Team", url: "/",
    title: "Winners Team — Where ambition becomes achievement", description: DESCRIPTION,
    images: [{ url: "/og-winners-team.jpg", width: 1200, height: 630, alt: "Winners Team" }],
  },
  twitter: { card: "summary_large_image", title: "Winners Team — Where ambition becomes achievement", description: DESCRIPTION, images: ["/og-winners-team.jpg"] },
};

/** Signed-in people go straight to their workspace; everyone else sees the public website. */
export default async function Home() {
  const p = await getCurrentProfile();
  if (!p) return <Landing />;
  if (p.status === "pending" || p.status === "rejected") redirect("/pending-approval");
  redirect(homeFor(p.role));
}
