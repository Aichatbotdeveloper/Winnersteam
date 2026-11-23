"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Icon, cn } from "@/components/ui";
import { SubmitButton, type ActionResult } from "@/components/ui/client";
import { submitFeedback } from "@/server/actions/feedback";

const TYPES = [
  { value: "suggestion", label: "Suggestion", icon: "lightbulb" },
  { value: "problem", label: "Something isn't working", icon: "bug_report" },
  { value: "compliment", label: "Compliment", icon: "favorite" },
  { value: "other", label: "Other", icon: "chat" },
] as const;

export function FeedbackForm({ signedInAs, from }: { signedInAs: { name: string; email: string } | null; from?: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(submitFeedback, null);
  const [type, setType] = useState<string>("suggestion");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);

  if (state?.ok) {
    return (
      <div className="card p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-emerald/15 text-on-tertiary-container"><Icon name="check_circle" className="text-[32px]" /></span>
        <h2 className="mt-4 font-heading text-heading-lg text-ink">Thank you!</h2>
        <p className="mt-2 text-body-lg text-muted-text">Your feedback has been sent to the Winners Team developer. Every message is read and helps us improve.</p>
        <a href={from && from.startsWith("/") ? from : "/"} className="mt-6 inline-flex items-center gap-1 font-semibold text-secondary hover:underline">
          <Icon name="arrow_back" className="text-[18px]" />Back to where you were
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="card space-y-5 p-5 sm:p-7">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="rating" value={rating || ""} />
      <input type="hidden" name="page" value={from ?? ""} />
      {/* Spam trap: hidden from people, bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <fieldset>
        <legend className="label">What is it about?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TYPES.map((t) => (
            <button key={t.value} type="button" aria-pressed={type === t.value} onClick={() => setType(t.value)}
              className={cn("flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center text-body-sm font-semibold transition-colors",
                type === t.value ? "border-secondary bg-surface-container-low text-secondary" : "border-border-subtle text-muted-text hover:border-secondary/50 hover:text-ink")}>
              <Icon name={t.icon} className="text-[22px]" />{t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">How do you like Winners Team? <span className="font-normal text-muted-text">(optional)</span></legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={rating === n}
              onMouseEnter={() => setHover(n)} onClick={() => setRating(rating === n ? 0 : n)}
              className="rounded p-0.5 transition-transform hover:scale-110">
              <Icon name="star" fill={(hover || rating) >= n} className={cn("text-[32px]", (hover || rating) >= n ? "text-accent-amber" : "text-border-strong")} />
            </button>
          ))}
          {rating > 0 && <span className="ml-2 text-body-sm text-muted-text">{["", "Poor", "Fair", "Good", "Very good", "Excellent"][rating]}</span>}
        </div>
      </fieldset>

      <label className="block">
        <span className="label">Your message</span>
        <textarea name="message" required minLength={3} maxLength={4000} rows={5} className="input resize-y"
          placeholder="What do you like, what is not working, and what should we improve?" />
      </label>

      {signedInAs ? (
        <p className="flex items-center gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-muted-text">
          <Icon name="person" className="text-[18px]" />Sending as <strong className="text-ink">{signedInAs.name}</strong> ({signedInAs.email})
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Your name <span className="font-normal text-muted-text">(optional)</span></span><input name="name" maxLength={120} autoComplete="name" className="input" /></label>
          <label className="block"><span className="label">Your email</span><input name="email" type="email" required maxLength={254} autoComplete="email" className="input" placeholder="you@example.com" /></label>
        </div>
      )}

      {state && !state.ok && <p role="alert" className="rounded-lg bg-accent-red/10 px-3 py-2 text-body-md text-accent-red">{state.message}</p>}
      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-muted-text">Your message goes straight to the Winners Team developer.</p>
        <SubmitButton variant="secondary" icon="send" pendingText="Sending…">Send feedback</SubmitButton>
      </div>
    </form>
  );
}
