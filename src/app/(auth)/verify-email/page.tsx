import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui";
import { resendVerification } from "../actions";

export const metadata: Metadata = { title: "Verify your e-mail" };

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="mx-auto max-w-xl card p-8 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-container-low text-secondary"><Icon name="mark_email_unread" className="text-[30px]" /></span>
      <h1 className="mt-4 font-heading text-heading-lg text-ink">Check your inbox</h1>
      <p className="mt-2 text-body-md text-muted-text">
        We sent a verification link to <strong className="text-ink">{email ?? "your e-mail address"}</strong>. Open it to confirm your address.
        After verification your registration waits for Super Admin approval.
      </p>
      <ActionForm action={resendVerification} className="mt-6">
        <input type="hidden" name="email" value={email ?? ""} />
        <SubmitButton variant="outline" icon="refresh">Resend verification e-mail</SubmitButton>
      </ActionForm>
      <Link href="/login" className="mt-6 inline-block text-body-md font-semibold text-link hover:underline">Back to sign in</Link>
    </div>
  );
}
