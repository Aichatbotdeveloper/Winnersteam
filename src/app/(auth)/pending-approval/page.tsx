import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Avatar, Badge, Icon, buttonClass, cn } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Registration status" };

export default async function PendingApproval() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: req } = await supabase.from("registration_requests").select("*").eq("profile_id", profile.id).maybeSingle();

  const approved = profile.status === "approved";
  const rejected = profile.status === "rejected";
  const steps = [
    { title: "Registration received", desc: "Your details were validated and stored.", state: "done", at: req?.submitted_at ?? profile.created_at },
    { title: "E-mail verified", desc: "You confirmed your e-mail address.", state: profile.email_verified_at ? "done" : "current", at: profile.email_verified_at },
    { title: "Super Admin review", desc: rejected ? `Not approved: ${profile.status_reason ?? ""}` : "The Super Admin reviews your application and assigns an administrator.",
      state: approved ? "done" : rejected ? "failed" : profile.email_verified_at ? "current" : "todo", at: req?.decided_at },
    { title: "Account activated", desc: "Sign in to your Team Member workspace.", state: approved ? "done" : "todo", at: profile.approved_at },
  ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="card p-6 md:p-8">
        <Badge tone={approved ? "green" : rejected ? "red" : "amber"} dot>
          STATUS: {approved ? "APPROVED" : rejected ? "NOT APPROVED" : "PENDING APPROVAL"}
        </Badge>
        <h1 className="mt-3 font-heading text-display-lg-mobile text-ink md:text-display-lg">
          {approved ? "Your account is approved" : rejected ? "Your registration was not approved" : "Registration under review"}
        </h1>
        <p className="mt-2 text-body-lg font-normal text-muted-text">
          {approved ? "Welcome to Winners Team. Your workspace is ready."
            : rejected ? "If you believe this is a mistake, please contact the office."
            : "Your registration has been received and is awaiting Super Admin approval. You will be notified by e-mail once a decision is made."}
        </p>

        <div className="mt-6 rounded-xl border border-border-subtle bg-surface-container-low p-5">
          <div className="flex items-center gap-4">
            <Avatar name={profile.full_name} size={56} />
            <div className="min-w-0">
              <div className="font-heading text-heading-md text-ink">{profile.full_name}</div>
              <div className="truncate text-body-md text-muted-text">{profile.email}</div>
              {profile.job_title && <div className="text-body-sm text-muted-text">{profile.job_title}{profile.team_name ? ` · ${profile.team_name}` : ""}</div>}
            </div>
          </div>
          {req?.requested_specialisation && <p className="mt-3 text-body-sm text-muted-text">Requested specialisation: <span className="text-ink">{req.requested_specialisation}</span></p>}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {approved
            ? <Link href={`${homeFor(profile.role)}?welcome=1`} className={buttonClass("primary")}>Go to my workspace</Link>
            : <Link href="/pending-approval" className={buttonClass("primary")}><Icon name="refresh" className="text-[18px]" />Refresh approval status</Link>}
          <form action={signOut}><button className={buttonClass("outline")}><Icon name="logout" className="text-[18px]" />Sign out</button></form>
        </div>
      </section>

      <aside className="card h-fit p-6">
        <h2 className="font-heading text-heading-md text-ink">Registration timeline</h2>
        <ol className="mt-5">
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex gap-3 pb-6 last:pb-0">
              {i < steps.length - 1 && <span className="absolute left-[17px] top-9 h-[calc(100%-36px)] w-0.5 bg-border-subtle" />}
              <span className={cn("z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                s.state === "done" ? "bg-on-tertiary-container text-white" : s.state === "current" ? "bg-accent-amber text-white" : s.state === "failed" ? "bg-accent-red text-white" : "bg-surface-alt text-faint-text")}>
                <Icon name={s.state === "done" ? "check" : s.state === "failed" ? "close" : s.state === "current" ? "hourglass_top" : "radio_button_unchecked"} className="text-[18px]" />
              </span>
              <div>
                <div className="text-label-md text-ink">{s.title}</div>
                <div className="text-body-sm text-muted-text">{s.desc}</div>
                {s.at && s.state !== "todo" && <div className="mt-0.5 text-body-sm text-faint-text">{fmtDateTime(s.at)}</div>}
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
