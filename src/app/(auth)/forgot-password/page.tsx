import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field } from "@/components/ui";
import { forgotPassword } from "../actions";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPassword() {
  return (
    <div className="mx-auto max-w-md card p-8">
      <h1 className="font-heading text-heading-lg text-ink">Forgot your password?</h1>
      <p className="mt-1 text-body-md text-muted-text">Enter your e-mail and we will send you a secure reset link.</p>
      <ActionForm action={forgotPassword} className="mt-6 space-y-4">
        <Field label="E-mail"><input name="email" type="email" required autoComplete="email" className="input" /></Field>
        <SubmitButton className="w-full" icon="send">Send reset link</SubmitButton>
      </ActionForm>
      <Link href="/login" className="mt-6 inline-block text-body-md font-semibold text-link hover:underline">Back to sign in</Link>
    </div>
  );
}
