import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Field, Icon } from "@/components/ui";
import { register } from "../actions";

export const metadata: Metadata = { title: "Register" };

const STEPS = [
  ["edit_note", "Submit details", "Tell us who you are and your team."],
  ["mark_email_read", "Verify e-mail", "Confirm the link we send you."],
  ["how_to_reg", "Super Admin approval", "You are assigned to an administrator."],
];

export default function RegisterPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="card p-6 md:p-8">
        <div className="eyebrow">Team member onboarding</div>
        <h1 className="mt-1 font-heading text-display-lg-mobile text-ink md:text-display-lg">Create your Winners Team account</h1>
        <p className="mt-1 text-body-md text-muted-text">Administrators are invited by the Super Admin and do not register here.</p>
        <ActionForm action={register} className="mt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full name *"><input name="full_name" required maxLength={120} autoComplete="name" className="input" /></Field>
            <Field label="Work e-mail *"><input name="email" type="email" required autoComplete="email" className="input" /></Field>
            <Field label="Phone number"><input name="phone" type="tel" maxLength={40} autoComplete="tel" className="input" placeholder="+234…" /></Field>
            <Field label="Job title / position"><input name="job_title" maxLength={120} className="input" /></Field>
            <Field label="Team name"><input name="team_name" maxLength={120} className="input" /></Field>
            <Field label="Team leader's name"><input name="team_leader_name" maxLength={120} className="input" /></Field>
            <Field label="Specialisation / services offered" className="md:col-span-2"><input name="requested_specialisation" maxLength={200} className="input" placeholder="e.g. Website development, digital marketing" /></Field>
            <Field label="Password *" hint="At least 10 characters with letters and numbers."><PasswordInput name="password" required minLength={10} autoComplete="new-password" className="input" /></Field>
            <Field label="Confirm password *"><PasswordInput name="confirm" required autoComplete="new-password" className="input" /></Field>
          </div>
          <label className="mt-5 flex items-start gap-2 text-body-md text-muted-text">
            <input type="checkbox" name="consent" className="mt-1 accent-secondary" required />
            I confirm this information is accurate and understand my account must be approved by the Super Admin before I can sign in.
          </label>
          <SubmitButton className="mt-5 w-full py-3" icon="person_add" pendingText="Submitting…">Submit registration</SubmitButton>
        </ActionForm>
        <p className="mt-6 text-center text-body-md text-muted-text">Already registered? <Link href="/login" className="font-semibold text-ink hover:underline">Sign in</Link></p>
      </section>
      <aside className="card h-fit p-6">
        <div className="eyebrow">Registration lifecycle</div>
        <ol className="mt-4 space-y-4">
          {STEPS.map(([icon, t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-low text-secondary"><Icon name={icon!} /></span>
              <div><div className="text-label-md text-ink">{i + 1}. {t}</div><div className="text-body-sm text-muted-text">{d}</div></div>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-lg bg-surface-alt p-3 text-body-sm text-muted-text">E-mail verification and Super Admin approval are separate steps — a verified e-mail does not mean your account is approved.</div>
      </aside>
    </div>
  );
}
