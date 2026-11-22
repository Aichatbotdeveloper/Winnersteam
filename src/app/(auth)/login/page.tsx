import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { signIn } from "../actions";
import { RoleShowcase } from "./RoleShowcase";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That link is invalid or has expired. Please request a new one.",
  inactive: "Your account is not active. Contact the Super Admin.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <section className="card p-6 md:p-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-label-sm uppercase tracking-wider text-muted-text">
            <span className="h-2 w-2 rounded-full bg-accent-emerald" /> Secure sign-in
          </span>
          <span className="flex items-center gap-1 rounded-md bg-surface-alt px-2 py-1 text-body-sm text-muted-text"><Icon name="lock" className="text-[16px]" />Role-based access</span>
        </div>
        <h1 className="font-heading text-display-lg-mobile text-ink md:text-[34px] md:leading-tight md:tracking-tight">Sign in to Winners Team</h1>
        <p className="mt-1 text-body-lg font-normal text-muted-text">Your role and workspace are applied automatically after sign-in.</p>

        {sp.error && ERRORS[sp.error] && (
          <p role="alert" className="mt-5 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">{ERRORS[sp.error]}</p>
        )}

        <ActionForm action={signIn} className="mt-6 space-y-5">
          <input type="hidden" name="next" value={sp.next ?? ""} />
          <label className="block">
            <span className="label">Work e-mail</span>
            <span className="relative block">
              <Icon name="mail" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-text" />
              <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="input py-3 pl-10" />
            </span>
          </label>
          <label className="block">
            <span className="mb-1 flex items-center justify-between">
              <span className="text-label-md text-body-text">Password</span>
              <Link href="/forgot-password" className="text-body-sm font-semibold text-link hover:underline">Forgot password?</Link>
            </span>
            <span className="relative block">
              <Icon name="key" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-text" />
              <PasswordInput name="password" required autoComplete="current-password" placeholder="••••••••••" className="input py-3 pl-10" />
            </span>
          </label>
          <SubmitButton className="w-full py-3.5 text-body-lg" icon="login" pendingText="Signing in…">Sign in to Winners Team</SubmitButton>
        </ActionForm>
        <p className="mt-8 text-center text-body-md text-muted-text">
          New team member? <Link href="/register" className="font-semibold text-ink hover:underline">Register for an account</Link>
        </p>
      </section>
      <RoleShowcase />
    </div>
  );
}
