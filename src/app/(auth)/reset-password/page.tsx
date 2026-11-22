import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "../actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login?error=link");
  return (
    <div className="mx-auto max-w-md card p-8">
      <h1 className="font-heading text-heading-lg text-ink">Choose a new password</h1>
      <p className="mt-1 text-body-md text-muted-text">Enter a new password for your account.</p>
      <ActionForm action={updatePassword} className="mt-6 space-y-4">
        <Field label="New password" hint="At least 10 characters with letters and numbers."><input name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /></Field>
        <Field label="Confirm password"><input name="confirm" type="password" required autoComplete="new-password" className="input" /></Field>
        <SubmitButton className="w-full" icon="lock_reset">Save password</SubmitButton>
      </ActionForm>
    </div>
  );
}
