"use client";

import { ActionForm, ConfirmAction, ModalButton, SubmitButton } from "@/components/ui/client";
import { Field } from "@/components/ui";
import { deleteService, removeAvatar, saveService, updateBasicInfo, updateProfessionalInfo, uploadAvatar } from "@/server/actions/profile";

type P = { full_name: string; phone: string | null; job_title: string | null; team_name: string | null; team_leader_name: string | null;
  specialisations: string[]; skills: string[]; business_interests: string[]; target_audience: string | null; portfolio_links: string[]; avatar_path: string | null };
export type Service = { id: string; name: string; description: string | null; category_id: string | null; key_benefits: string[]; target_audience: string | null; portfolio_url: string | null };

export function BasicForm({ p, isMember }: { p: P; isMember: boolean }) {
  return (
    <ActionForm action={updateBasicInfo} className="grid gap-4 md:grid-cols-2">
      <Field label="Full name *"><input name="full_name" required maxLength={120} defaultValue={p.full_name} className="input" /></Field>
      <Field label="Phone number"><input name="phone" maxLength={40} defaultValue={p.phone ?? ""} className="input" /></Field>
      <Field label="Job title / position"><input name="job_title" maxLength={120} defaultValue={p.job_title ?? ""} className="input" /></Field>
      <Field label="Team name"><input name="team_name" maxLength={120} defaultValue={p.team_name ?? ""} className="input" /></Field>
      {isMember && <Field label="Team leader's name"><input name="team_leader_name" maxLength={120} defaultValue={p.team_leader_name ?? ""} className="input" /></Field>}
      <div className="flex items-end justify-end md:col-span-2"><SubmitButton icon="save">Save basic information</SubmitButton></div>
    </ActionForm>
  );
}

export function ProfessionalForm({ p }: { p: P }) {
  return (
    <ActionForm action={updateProfessionalInfo} className="grid gap-4 md:grid-cols-2">
      <Field label="Professional specialisations" hint="Comma or line separated"><textarea name="specialisations" rows={2} defaultValue={p.specialisations.join(", ")} className="input" /></Field>
      <Field label="Skills & competencies" hint="Comma or line separated"><textarea name="skills" rows={2} defaultValue={p.skills.join(", ")} className="input" /></Field>
      <Field label="Business interests" hint="Comma or line separated"><textarea name="business_interests" rows={2} defaultValue={p.business_interests.join(", ")} className="input" /></Field>
      <Field label="Target audience"><textarea name="target_audience" rows={2} maxLength={1000} defaultValue={p.target_audience ?? ""} className="input" /></Field>
      <Field label="Portfolio links" hint="One URL per line (max 10)" className="md:col-span-2"><textarea name="portfolio_links" rows={2} defaultValue={p.portfolio_links.join("\n")} className="input" /></Field>
      <div className="flex justify-end md:col-span-2"><SubmitButton icon="save">Save professional information</SubmitButton></div>
    </ActionForm>
  );
}

export function ServiceForm({ categories, service }: { categories: { id: string; name: string }[]; service?: Service }) {
  return (
    <ActionForm action={saveService} resetOnSuccess={!service} className="space-y-4">
      {service && <input type="hidden" name="id" value={service.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service name *"><input name="name" required maxLength={120} defaultValue={service?.name} className="input" /></Field>
        <Field label="Category" hint="Used to personalise your service updates">
          <select name="category_id" defaultValue={service?.category_id ?? ""} className="input">
            <option value="">Select a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea name="description" rows={3} maxLength={2000} defaultValue={service?.description ?? ""} className="input" /></Field>
      <Field label="Key benefits" hint="Comma or line separated (max 10)"><textarea name="key_benefits" rows={2} defaultValue={service?.key_benefits.join("\n") ?? ""} className="input" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Target audience"><input name="target_audience" maxLength={500} defaultValue={service?.target_audience ?? ""} className="input" /></Field>
        <Field label="Portfolio / demo link"><input name="portfolio_url" type="url" defaultValue={service?.portfolio_url ?? ""} className="input" placeholder="https://" /></Field>
      </div>
      <div className="flex justify-end"><SubmitButton icon="save">{service ? "Save service" : "Add service"}</SubmitButton></div>
    </ActionForm>
  );
}

export function ServiceActions({ categories, service }: { categories: { id: string; name: string }[]; service: Service }) {
  return (
    <div className="flex gap-1">
      <ModalButton label="Edit" title="Edit service" icon="edit" variant="ghost" size="sm" wide><ServiceForm categories={categories} service={service} /></ModalButton>
      <ConfirmAction action={deleteService} label="Remove" icon="delete" variant="ghost" confirm={`Remove the service "${service.name}"?`} fields={{ id: service.id }} />
    </div>
  );
}

export function AvatarForm({ hasAvatar }: { hasAvatar: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionForm action={uploadAvatar} className="flex flex-wrap items-center gap-2">
        <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp" required className="max-w-56 text-body-sm file:mr-2 file:rounded-lg file:border-0 file:bg-surface-container-low file:px-3 file:py-1.5 file:text-body-sm file:font-semibold file:text-secondary" aria-label="Profile photo" />
        <SubmitButton size="sm" variant="outline" icon="upload">Upload photo</SubmitButton>
      </ActionForm>
      {hasAvatar && <ActionForm action={removeAvatar}><SubmitButton size="sm" variant="ghost" icon="delete">Remove</SubmitButton></ActionForm>}
    </div>
  );
}
