import type { Metadata } from "next";
import { getCurrentProfile } from "@/lib/auth";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";

export const metadata: Metadata = { title: "Talk to the developer", description: "Send feedback about Winners Team: what you like, what isn't working and what to improve." };

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const me = await getCurrentProfile();
  const user = me && me.status === "approved" ? { name: me.full_name, email: me.email } : null;
  return (
    <>
      <h1>Talk to the developer</h1>
      <p>Tell us what you think of Winners Team: what you like, what isn&apos;t working and what we can do better. Every message is read.</p>
      <div className="mt-8"><FeedbackForm signedInAs={user} from={from?.startsWith("/") ? from.slice(0, 300) : undefined} /></div>
    </>
  );
}
