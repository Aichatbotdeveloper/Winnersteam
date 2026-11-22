import { createClient } from "@/lib/supabase/server";
import { Avatar, Badge, Card, CardHeader, EmptyState, Icon } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { AvatarForm, BasicForm, ProfessionalForm, ServiceActions, ServiceForm, type Service } from "./Forms";
import { avatarUrl } from "@/server/storage";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { fmtDate, fmtDateTime, timeAgo } from "@/lib/format";
import type { Profile } from "@/lib/auth";

function Chips({ items, empty = "Not provided" }: { items: string[]; empty?: string }) {
  return items.length ? <div className="flex flex-wrap gap-1.5">{items.map((s) => <Badge key={s} tone="purple">{s}</Badge>)}</div> : <span className="text-faint-text">{empty}</span>;
}

/** Single unified profile: basic + professional + services sections. */
export async function ProfileView({ profile, editable }: { profile: Profile; editable: boolean }) {
  const supabase = await createClient();
  const [services, categories, history, admin] = await Promise.all([
    supabase.from("profile_services").select("*, category:service_categories(name)").eq("profile_id", profile.id).order("position").order("created_at"),
    supabase.from("service_categories").select("id,name").eq("active", true).order("name"),
    supabase.from("profile_change_log").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(15),
    editable ? supabase.rpc("my_administrator") : supabase.from("admin_assignments").select("administrator:profiles!admin_assignments_administrator_id_fkey(full_name)").eq("member_id", profile.id).is("ended_at", null).maybeSingle(),
  ]);
  const adminName = editable ? (admin.data as { full_name: string }[] | null)?.[0]?.full_name
    : ((admin.data as { administrator: { full_name: string } | null } | null)?.administrator?.full_name);
  const photo = await avatarUrl(profile.avatar_path);
  const isMember = profile.role === "team_member";
  const cats = categories.data ?? [];

  return (
    <div className="space-y-5">
      <Card className="p-5 md:p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={profile.full_name} src={photo} size={72} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-heading-lg text-ink">{profile.full_name}</h2>
                <Badge tone="purple">{ROLE_LABEL[profile.role]}</Badge>
                <Badge tone={profile.status === "approved" ? "green" : "amber"}>{STATUS_LABEL[profile.status]}</Badge>
              </div>
              <div className="text-body-md text-muted-text">{profile.job_title ?? "No job title"}{profile.team_name ? ` · ${profile.team_name}` : ""}</div>
              {isMember && <div className="text-body-sm text-muted-text">Assigned administrator: <span className="text-ink">{adminName ?? "Not assigned"}</span></div>}
            </div>
          </div>
          {editable && <AvatarForm hasAvatar={Boolean(profile.avatar_path)} />}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader icon="person" title="Basic information" eyebrow="Section 1 of 3" />
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-body-md sm:grid-cols-2 lg:grid-cols-4">
          {[["E-mail", profile.email], ["Phone", profile.phone], ["Job title", profile.job_title], ["Team name", profile.team_name],
            ...(isMember ? [["Team leader", profile.team_leader_name]] : []), ["Registered", fmtDate(profile.created_at)],
            ["E-mail verified", profile.email_verified_at ? fmtDate(profile.email_verified_at) : "Not verified"], ["Last updated", fmtDateTime(profile.updated_at)]].map(([k, v]) => (
            <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5 break-words text-ink">{v || <span className="text-faint-text">—</span>}</dd></div>
          ))}
        </dl>
        {editable && <details className="mt-5 rounded-lg border border-border-subtle p-4"><summary className="cursor-pointer text-label-md text-secondary">Edit basic information</summary><div className="mt-4"><BasicForm p={profile} isMember={isMember} /></div></details>}
      </Card>

      <Card className="p-5">
        <CardHeader icon="work" title="Professional information" eyebrow="Section 2 of 3" />
        <dl className="mt-4 grid gap-5 text-body-md md:grid-cols-2">
          <div><dt className="eyebrow mb-1">Specialisations</dt><dd><Chips items={profile.specialisations} /></dd></div>
          <div><dt className="eyebrow mb-1">Skills & competencies</dt><dd><Chips items={profile.skills} /></dd></div>
          <div><dt className="eyebrow mb-1">Business interests</dt><dd><Chips items={profile.business_interests} /></dd></div>
          <div><dt className="eyebrow mb-1">Target audience</dt><dd className="text-ink">{profile.target_audience ?? <span className="text-faint-text">Not provided</span>}</dd></div>
          <div className="md:col-span-2"><dt className="eyebrow mb-1">Portfolio links</dt><dd className="flex flex-col gap-1">
            {profile.portfolio_links.length ? profile.portfolio_links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-link hover:underline">{l}</a>) : <span className="text-faint-text">Not provided</span>}
          </dd></div>
        </dl>
        {editable && <details className="mt-5 rounded-lg border border-border-subtle p-4"><summary className="cursor-pointer text-label-md text-secondary">Edit professional information</summary><div className="mt-4"><ProfessionalForm p={profile} /></div></details>}
      </Card>

      <Card className="p-5">
        <CardHeader icon="design_services" title="Services" eyebrow="Section 3 of 3 · part of this single profile"
          action={editable ? <ModalButton label="Add service" title="Add a service" icon="add" size="sm" wide><ServiceForm categories={cats} /></ModalButton> : undefined} />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(services.data ?? []).length === 0 && <div className="md:col-span-2"><EmptyState icon="design_services" title="No services listed">{editable ? "Add the services you offer. Categories personalise your professional updates feed." : null}</EmptyState></div>}
          {(services.data ?? []).map((s) => (
            <div key={s.id} className="rounded-xl border border-border-subtle p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-heading text-body-lg text-ink">{s.name}</div>
                  {(s.category as unknown as { name: string } | null)?.name && <Badge tone="blue">{(s.category as unknown as { name: string }).name}</Badge>}
                </div>
                {editable && <ServiceActions categories={cats} service={s as unknown as Service} />}
              </div>
              {s.description && <p className="mt-2 text-body-md text-muted-text">{s.description}</p>}
              {s.key_benefits.length > 0 && <ul className="mt-2 space-y-0.5 text-body-sm text-body-text">{s.key_benefits.map((b) => <li key={b} className="flex gap-1.5"><Icon name="check" className="text-[16px] text-on-tertiary-container" />{b}</li>)}</ul>}
              <div className="mt-2 flex flex-wrap gap-3 text-body-sm text-muted-text">
                {s.target_audience && <span>Audience: {s.target_audience}</span>}
                {s.portfolio_url && <a href={s.portfolio_url} target="_blank" rel="noopener noreferrer nofollow" className="text-link hover:underline">Portfolio / demo ↗</a>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader icon="history" title="Profile modification history" eyebrow="Changes notify the assigned administrator and the Super Admin" />
        {(history.data ?? []).length === 0 ? <p className="mt-3 text-body-md text-muted-text">No changes recorded yet.</p> : (
          <ol className="mt-4 space-y-3">
            {(history.data ?? []).map((h) => {
              const c = h.changes as Record<string, unknown>;
              const fields = h.section === "services" ? [`${String(c.action)} service “${String(c.service)}”`] : Object.keys(c).map((k) => k.replace(/_/g, " "));
              return (
                <li key={h.id} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-secondary" />
                  <div className="text-body-md">
                    <span className="capitalize text-ink">{h.section}</span> <span className="text-muted-text">— {fields.join(", ")}</span>
                    {h.section !== "services" && (
                      <div className="mt-0.5 space-y-0.5 text-body-sm text-muted-text">
                        {Object.entries(c).slice(0, 4).map(([k, v]) => {
                          const vv = v as { old: unknown; new: unknown };
                          const show = (x: unknown) => Array.isArray(x) ? x.join(", ") || "∅" : x === null || x === undefined || x === "" ? "∅" : String(x);
                          return <div key={k} className="truncate"><span className="text-faint-text">{k.replace(/_/g, " ")}:</span> {show(vv.old)} → <span className="text-ink">{show(vv.new)}</span></div>;
                        })}
                      </div>
                    )}
                    <div className="text-[11px] text-faint-text">{timeAgo(h.created_at)} · {fmtDateTime(h.created_at)}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
