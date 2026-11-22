import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, Field, Icon, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { ActionForm, ConfirmAction, ModalButton, SubmitButton } from "@/components/ui/client";
import * as A from "@/server/actions/settings";
import { CATEGORY_LABEL, CONSEQUENCE_COLOR, CONSEQUENCE_LABEL, CONSEQUENCE_LIMITS, consequenceText } from "@/lib/labels";
import { daysAgoIso, fmtDateTime } from "@/lib/format";
import { serverEnv, env } from "@/lib/env";

export const metadata: Metadata = { title: "System Settings" };

const SECTIONS = [
  { key: "general", label: "General & performance", icon: "tune" },
  { key: "accountability", label: "Accountability", icon: "cyclone" },
  { key: "reminders", label: "Reminders", icon: "alarm" },
  { key: "sources", label: "Service update sources", icon: "rss_feed" },
  { key: "books", label: "Books", icon: "menu_book" },
  { key: "quotes", label: "Quotes", icon: "format_quote" },
  { key: "lex", label: "LEX", icon: "smart_toy" },
  { key: "categories", label: "Categories", icon: "category" },
];
const Check = ({ name, label, checked }: { name: string; label: string; checked: boolean }) => (
  <label className="flex items-center gap-2 text-body-md"><input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4 accent-secondary" />{label}</label>
);
const PERF = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[];
const QUOTE_CATS = ["discipline", "consistency", "success", "business", "leadership", "excellence", "personal_growth", "productivity"];

export default async function SettingsPage({ params }: { params: Promise<{ section?: string[] }> }) {
  await requireUser(["super_admin"]);
  const { section: seg } = await params;
  const section = seg?.[0] ?? "general";
  if (!SECTIONS.some((s) => s.key === section) || (seg?.length ?? 0) > 1) notFound();
  const supabase = await createClient();
  let body: React.ReactNode = null;

  if (section === "general") {
    const [settings, perf] = await Promise.all([supabase.from("system_settings").select("*"), supabase.from("performance_settings").select("*").single()]);
    const s = Object.fromEntries((settings.data ?? []).map((x) => [x.key, x.value]));
    const p = perf.data!;
    const env_ = serverEnv();
    const integrations = [
      ["AI provider (LEX & summaries)", Boolean(env_.aiApiKey), "AI_PROVIDER / AI_API_KEY / AI_MODEL"],
      ["E-mail delivery (Resend)", Boolean(env_.resendApiKey && env_.emailFrom), "RESEND_API_KEY / EMAIL_FROM"],
      ["Browser push (VAPID)", Boolean(env.vapidPublicKey && env_.vapidPrivateKey), "NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT"],
      ["Scheduled jobs secret", env_.cronSecret.length >= 16, "CRON_SECRET"],
    ] as const;
    body = (
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader icon="functions" title="Performance weights" eyebrow={`Last updated ${fmtDateTime(p.updated_at)}`} />
          <ActionForm action={A.saveWeights} className="mt-4 space-y-3">
            {([["w_daily", "Daily To-Do List", p.w_daily], ["w_weekly", "Weekly Goals", p.w_weekly], ["w_prospecting", "Prospecting Targets", p.w_prospecting], ["w_monthly", "Monthly Goals", p.w_monthly], ["w_additional", "Additional Tasks", p.w_additional]] as const).map(([k, l, v]) => (
              <label key={k} className="flex items-center justify-between gap-3"><span className="text-body-md text-ink">{l}</span><span className="flex items-center gap-1"><input name={k} type="number" min={0} max={100} step="0.5" defaultValue={Number(v)} className="input w-24 text-right" />%</span></label>
            ))}
            <p className="text-body-sm text-muted-text">Must total exactly 100%. Inapplicable categories are excluded and the rest normalised automatically.</p>
            <div className="flex justify-end"><SubmitButton icon="save">Save weights</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card className="p-5">
          <CardHeader icon="settings" title="General settings" />
          <ActionForm action={A.saveGeneral} className="mt-4 space-y-3">
            <Field label="Organisation name"><input name="org_name" defaultValue={String(s["org.name"] ?? "Winners Team")} className="input" /></Field>
            <Field label="Reporting timezone (IANA)" hint="Defines when days, weeks and months start and close."><input name="timezone" defaultValue={String(s["org.timezone"] ?? "Africa/Lagos")} className="input" /></Field>
            <Check name="registration_open" label="Public team-member registration is open" checked={s["registration.open"] !== false} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quote no-repeat window (logins)"><input name="no_repeat" type="number" min={0} max={100} defaultValue={Number(s["quotes.no_repeat_window"] ?? 10)} className="input" /></Field>
              <Field label="Max items per source per run"><input name="max_items" type="number" min={1} max={50} defaultValue={Number(s["service_updates.max_items_per_source"] ?? 20)} className="input" /></Field>
            </div>
            <p className="text-body-sm text-muted-text">Currency for financial accountability is fixed to NGN (₦).</p>
            <div className="flex justify-end"><SubmitButton icon="save">Save</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card className="p-5 xl:col-span-2">
          <CardHeader icon="hub" title="Integrations" eyebrow="Configured with server environment variables — secrets are never stored in the database" />
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {integrations.map(([l, ok, vars]) => (
              <li key={l} className="flex items-center justify-between gap-2 rounded-lg bg-surface-alt px-3 py-2.5"><span><span className="block text-body-md text-ink">{l}</span><code className="text-[11px] text-muted-text">{vars}</code></span><Badge tone={ok ? "green" : "amber"}>{ok ? "Configured" : "Not configured"}</Badge></li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
            <ActionForm action={A.sendTestEmail}><SubmitButton variant="outline" icon="forward_to_inbox">Send test e-mail to me</SubmitButton></ActionForm>
            <ActionForm action={A.deliverPendingNow}><SubmitButton variant="outline" icon="send">Deliver pending notifications now</SubmitButton></ActionForm>
          </div>
        </Card>
      </div>
    );
  }

  if (section === "accountability") {
    const [set, opts, recent] = await Promise.all([
      supabase.from("accountability_settings").select("*").single(),
      supabase.from("accountability_options").select("*").order("category").order("quantity"),
      supabase.from("accountability_ledger").select("category").gte("assigned_at", daysAgoIso(30)),
    ]);
    const s = set.data!;
    const dist = new Map<string, number>();
    for (const r of recent.data ?? []) dist.set(r.category, (dist.get(r.category) ?? 0) + 1);
    const optionForm = (o?: NonNullable<typeof opts.data>[number]) => (
      <ActionForm action={A.saveOption} resetOnSuccess={!o} className="space-y-3">
        {o && <input type="hidden" name="id" value={o.id} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Category (fixed list)"><select name="category" defaultValue={o?.category ?? "frog_jumps"} className="input">{Object.entries(CONSEQUENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Quantity / amount" hint="Frog 10–400 · Legs 10–60 min · Offices 1–10 · Fine ₦200–₦5,000"><input name="quantity" type="number" required step={1} defaultValue={o ? Number(o.quantity) : ""} className="input" /></Field>
          <Field label="Selection weight (1–100)"><input name="weight" type="number" min={1} max={100} defaultValue={o?.weight ?? 10} className="input" /></Field>
        </div>
        <div><span className="label">Applies to levels</span><div className="flex flex-wrap gap-4">{(["low", "moderate", "high"] as const).map((l) => <Check key={l} name={`level_${l}`} label={l} checked={o ? o.levels.includes(l) : true} />)}</div></div>
        <div><span className="label">Triggering categories</span><div className="flex flex-wrap gap-4">{PERF.map((p) => <Check key={p} name={`applies_${p}`} label={CATEGORY_LABEL[p]} checked={o ? o.applies_to.includes(p) : p !== "daily_todo" || true} />)}</div></div>
        <Check name="active" label="Active on the wheel" checked={o?.active ?? true} />
        <div className="flex justify-end"><SubmitButton icon="save">{o ? "Save sector" : "Add sector"}</SubmitButton></div>
      </ActionForm>
    );
    body = (
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <Card className="p-5">
            <CardHeader icon="stairs" title="Thresholds & cadence" />
            <ActionForm action={A.saveAccountabilitySettings} className="mt-4 space-y-3">
              <Check name="enabled" label="Accountability engine enabled" checked={s.enabled} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="No consequence from (%)"><input name="none" type="number" step="0.5" defaultValue={Number(s.threshold_none)} className="input" /></Field>
                <Field label="Low from (%)"><input name="low" type="number" step="0.5" defaultValue={Number(s.threshold_low)} className="input" /></Field>
                <Field label="Moderate from (%)"><input name="moderate" type="number" step="0.5" defaultValue={Number(s.threshold_moderate)} className="input" /></Field>
              </div>
              <p className="text-body-sm text-muted-text">Below “moderate” is High. Ranges always cover 0–100% with no gaps or overlaps.</p>
              <div className="flex flex-wrap gap-4"><Check name="daily" label="Evaluate daily" checked={s.evaluate_daily} /><Check name="weekly" label="Evaluate weekly" checked={s.evaluate_weekly} /><Check name="monthly" label="Evaluate monthly" checked={s.evaluate_monthly} /></div>
              <Field label="Automatic draw if not spun within (hours)"><input name="auto_hours" type="number" min={1} max={168} defaultValue={s.auto_draw_after_hours} className="input w-32" /></Field>
              <p className="flex gap-1.5 rounded-lg bg-surface-alt px-3 py-2 text-body-sm text-muted-text"><Icon name="info" className="text-[16px]" />Selected consequences are assigned immediately — there is no approval or sign-off step.</p>
              <div className="flex justify-end"><SubmitButton icon="save">Save</SubmitButton></div>
            </ActionForm>
            <ActionForm action={A.runEvaluationsNow} className="mt-4 border-t border-border-subtle pt-4"><SubmitButton variant="outline" icon="play_arrow">Run evaluations now</SubmitButton></ActionForm>
          </Card>
          <Card className="p-5">
            <CardHeader icon="pie_chart" title="Last 30 days" eyebrow="Outcomes by category" />
            <ul className="mt-4 space-y-2">{Object.entries(CONSEQUENCE_LABEL).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded" style={{ background: CONSEQUENCE_COLOR[k as keyof typeof CONSEQUENCE_COLOR] }} />{v}</span><Badge>{dist.get(k) ?? 0}</Badge></li>
            ))}</ul>
            <p className="mt-4 text-body-sm text-muted-text">Only four categories exist. The database rejects any other category and any quantity outside its limit.</p>
          </Card>
        </div>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3"><CardHeader icon="tune" title="Custom sector editor" eyebrow="Wheel options & calibration matrix" />
            <ModalButton label="Add sector" title="Add wheel sector" icon="add" wide>{optionForm()}</ModalButton></div>
          <Table>
            <thead><tr><Th>Sector</Th><Th>Limits</Th><Th>Levels</Th><Th>Triggers</Th><Th>Weight</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>{(opts.data ?? []).map((o) => (
              <tr key={o.id}>
                <Td><span className="flex items-center gap-2 font-medium text-ink"><span className="h-3 w-3 rounded" style={{ background: CONSEQUENCE_COLOR[o.category] }} />{consequenceText(o.category, o.quantity)}</span></Td>
                <Td className="text-body-sm text-muted-text">{CONSEQUENCE_LIMITS[o.category].min}–{CONSEQUENCE_LIMITS[o.category].max} {CONSEQUENCE_LIMITS[o.category].unit}</Td>
                <Td><div className="flex flex-wrap gap-1">{o.levels.map((l) => <Badge key={l} tone={l === "high" ? "red" : "amber"}>{l}</Badge>)}</div></Td>
                <Td className="max-w-56 text-body-sm text-muted-text">{o.applies_to.length === 5 ? "All categories" : o.applies_to.map((a) => CATEGORY_LABEL[a]).join(", ")}</Td>
                <Td>{o.weight}</Td>
                <Td><Badge tone={o.active ? "green" : "neutral"}>{o.active ? "Active" : "Inactive"}</Badge></Td>
                <Td className="text-right"><div className="flex justify-end gap-1">
                  <ModalButton label="Edit" title="Edit sector" icon="edit" variant="ghost" size="sm" wide>{optionForm(o)}</ModalButton>
                  <ConfirmAction action={A.deleteOption} label="Delete" icon="delete" variant="ghost" confirm="Delete this sector? (Sectors with history are deactivated instead.)" fields={{ id: o.id }} />
                </div></Td>
              </tr>
            ))}</tbody>
          </Table>
        </Card>
      </div>
    );
  }

  if (section === "reminders") {
    const { data } = await supabase.from("reminder_schedules").select("*").order("local_time");
    body = (
      <Card className="overflow-hidden">
        <div className="p-5 pb-3"><CardHeader icon="alarm" title="Reminder schedules" eyebrow="Times are in the organisation timezone · duplicate delivery is prevented per day" /></div>
        <Table>
          <thead><tr><Th>Reminder</Th><Th>When</Th><Th>Schedule</Th><Th>Last run</Th><Th className="text-right">Now</Th></tr></thead>
          <tbody>{(data ?? []).map((r) => (
            <tr key={r.kind}>
              <Td className="font-medium text-ink">{r.label}</Td>
              <Td className="text-body-sm text-muted-text">{r.weekday ? ["", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][r.weekday] : r.monthday ? (r.monthday > 0 ? `Day ${r.monthday} of month` : `${-r.monthday} days before month end`) : "Every day"}</Td>
              <Td><ActionForm action={A.saveReminder} className="flex items-center gap-2" showMessage={false}><input type="hidden" name="kind" value={r.kind} />
                <input type="time" name="local_time" defaultValue={r.local_time.slice(0, 5)} className="input w-28 py-1.5" /><Check name="enabled" label="On" checked={r.enabled} /><SubmitButton size="sm" variant="outline">Save</SubmitButton></ActionForm></Td>
              <Td className="text-body-sm text-muted-text">{r.last_run_on ?? "Never"}</Td>
              <Td className="text-right"><ConfirmAction action={A.sendReminderNow} label="Send now" icon="send" fields={{ kind: r.kind }} confirm="Generate this reminder for all eligible members now?" /></Td>
            </tr>
          ))}</tbody>
        </Table>
      </Card>
    );
  }

  if (section === "sources") {
    const [src, cats] = await Promise.all([
      supabase.from("service_update_sources").select("*, category:service_categories(name)").order("name"),
      supabase.from("service_categories").select("id,name").eq("active", true).order("name"),
    ]);
    const sourceForm = (s?: NonNullable<typeof src.data>[number]) => (
      <ActionForm action={A.saveSource} resetOnSuccess={!s} className="space-y-3">
        {s && <input type="hidden" name="id" value={s.id} />}
        <Field label="Source name *"><input name="name" required defaultValue={s?.name} className="input" placeholder="e.g. Official product blog" /></Field>
        <Field label="RSS / Atom feed URL (https) *" hint="Use official, reputable sources only."><input name="feed_url" required type="url" defaultValue={s?.feed_url} className="input" /></Field>
        <Field label="Homepage URL"><input name="homepage_url" type="url" defaultValue={s?.homepage_url ?? ""} className="input" /></Field>
        <Field label="Service category *"><select name="category_id" required defaultValue={s?.category_id ?? ""} className="input"><option value="" disabled>Choose…</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Check name="active" label="Active" checked={s?.active ?? true} />
        <div className="flex justify-end"><SubmitButton icon="save">Save source</SubmitButton></div>
      </ActionForm>
    );
    body = (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3"><CardHeader icon="rss_feed" title="Approved update sources" eyebrow="Fetched on schedule, matched to members by service category" />
          <div className="flex gap-2"><ActionForm action={A.fetchSourcesNow}><SubmitButton variant="outline" icon="sync">Fetch all now</SubmitButton></ActionForm><ModalButton label="Add source" title="Add approved source" icon="add">{sourceForm()}</ModalButton></div></div>
        {(src.data ?? []).length === 0 ? <p className="px-5 pb-5 text-body-md text-muted-text">No sources configured. Members see an empty state until you add approved feeds — nothing is ever invented.</p> : (
          <Table>
            <thead><tr><Th>Source</Th><Th>Category</Th><Th>Status</Th><Th>Last fetched</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>{(src.data ?? []).map((s) => (
              <tr key={s.id}>
                <Td><div className="font-medium text-ink">{s.name}</div><div className="max-w-80 truncate text-body-sm text-muted-text">{s.feed_url}</div></Td>
                <Td>{(s.category as unknown as { name: string }).name}</Td>
                <Td><Badge tone={!s.active ? "neutral" : s.last_status === "ok" ? "green" : s.last_status ? "red" : "amber"}>{!s.active ? "Inactive" : s.last_status ?? "Never fetched"}</Badge></Td>
                <Td className="text-body-sm text-muted-text">{s.last_fetched_at ? fmtDateTime(s.last_fetched_at) : "—"}</Td>
                <Td className="text-right"><div className="flex justify-end gap-1"><ModalButton label="Edit" title="Edit source" icon="edit" variant="ghost" size="sm">{sourceForm(s)}</ModalButton><ConfirmAction action={A.fetchSourcesNow} label="Fetch" icon="sync" variant="ghost" fields={{ id: s.id }} /></div></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    );
  }

  if (section === "books") {
    const [books, cats] = await Promise.all([supabase.from("books").select("*").order("title"), supabase.from("learning_categories").select("*").order("name")]);
    const bookForm = (b?: NonNullable<typeof books.data>[number]) => (
      <ActionForm action={A.saveBook} resetOnSuccess={!b} className="space-y-3">
        {b && <input type="hidden" name="id" value={b.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title *"><input name="title" required defaultValue={b?.title} className="input" /></Field>
          <Field label="Author *"><input name="author" required defaultValue={b?.author} className="input" /></Field>
          <Field label="Category *"><select name="category" defaultValue={b?.category} className="input">{(cats.data ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></Field>
          <Field label="Improvement area *"><input name="improvement_area" required defaultValue={b?.improvement_area} className="input" /></Field>
          <Field label="Licence *"><select name="license" defaultValue={b?.license ?? "commercial"} className="input"><option value="public_domain">Public domain</option><option value="open_access">Open access</option><option value="commercial">Commercial (no free link)</option></select></Field>
          <Field label="Cover image URL (https)"><input name="cover_url" type="url" defaultValue={b?.cover_url ?? ""} className="input" /></Field>
          <Field label="Reading / info link (https)"><input name="reading_url" type="url" defaultValue={b?.reading_url ?? ""} className="input" /></Field>
          <Field label="Legal free download (https)" hint="Only for public-domain / open-access works."><input name="free_download_url" type="url" defaultValue={b?.free_download_url ?? ""} className="input" /></Field>
        </div>
        <Field label="Description"><textarea name="description" rows={2} defaultValue={b?.description ?? ""} className="input" /></Field>
        <Check name="active" label="Active" checked={b?.active ?? true} />
        <div className="flex justify-end"><SubmitButton icon="save">Save book</SubmitButton></div>
      </ActionForm>
    );
    body = (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-3"><CardHeader icon="menu_book" title="Book library" eyebrow="No pirated copies — free links only for legally free works" /><ModalButton label="Add book" title="Add book" icon="add" wide>{bookForm()}</ModalButton></div>
        <Table>
          <thead><tr><Th>Book</Th><Th>Category</Th><Th>Licence</Th><Th>Links</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{(books.data ?? []).map((b) => (
            <tr key={b.id}><Td><div className="font-medium text-ink">{b.title}</div><div className="text-body-sm text-muted-text">{b.author}</div></Td><Td>{b.category}</Td>
              <Td><Badge tone={b.license === "commercial" ? "neutral" : "green"}>{b.license.replace("_", " ")}</Badge></Td>
              <Td className="text-body-sm">{b.reading_url ? "Read" : ""}{b.free_download_url ? " · Free" : ""}</Td>
              <Td><Badge tone={b.active ? "green" : "neutral"}>{b.active ? "Active" : "Inactive"}</Badge></Td>
              <Td className="text-right"><ModalButton label="Edit" title="Edit book" icon="edit" variant="ghost" size="sm" wide>{bookForm(b)}</ModalButton></Td></tr>
          ))}</tbody>
        </Table>
      </Card>
    );
  }

  if (section === "quotes") {
    const { data } = await supabase.from("motivational_quotes").select("*").order("created_at", { ascending: false });
    const shown = await supabase.from("quote_display_history").select("quote_id");
    const counts = new Map<string, number>();
    for (const h of shown.data ?? []) counts.set(h.quote_id, (counts.get(h.quote_id) ?? 0) + 1);
    const quoteForm = (q?: NonNullable<typeof data>[number]) => (
      <ActionForm action={A.saveQuote} resetOnSuccess={!q} className="space-y-3">
        {q && <input type="hidden" name="id" value={q.id} />}
        <Field label="Quote *"><textarea name="text" required rows={3} defaultValue={q?.text} className="input" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Author (accurate attribution) *"><input name="author" required defaultValue={q?.author} className="input" /></Field>
          <Field label="Source (book, speech…)"><input name="source" defaultValue={q?.source ?? ""} className="input" /></Field>
        </div>
        <Field label="Category"><select name="category" defaultValue={q?.category ?? "success"} className="input">{QUOTE_CATS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select></Field>
        <Check name="active" label="Active (shown at login)" checked={q?.active ?? true} />
        <div className="flex justify-end"><SubmitButton icon="save">Save quote</SubmitButton></div>
      </ActionForm>
    );
    body = (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-3"><CardHeader icon="format_quote" title="Motivational quotes" eyebrow={`${(data ?? []).filter((q) => q.active).length} active · rotated at every sign-in`} /><div className="flex flex-wrap gap-2">
          <ModalButton label="Import CSV" title="Import quotes from CSV" icon="upload_file" variant="outline">
            <ActionForm action={A.importQuotes} className="space-y-3">
              <p className="text-body-md text-muted-text">Upload a <strong>.csv</strong> file with the columns <code>text, author, source, category</code> (a header row is optional). Every quote needs an accurate author; duplicates are skipped automatically.</p>
              <p className="text-body-sm text-muted-text">Categories: {QUOTE_CATS.map((c) => c).join(", ")}. Leave it blank for “success”.</p>
              <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-body-sm file:mr-2 file:rounded-lg file:border-0 file:bg-surface-container-low file:px-3 file:py-1.5 file:font-semibold file:text-secondary" />
              <a href="/brand/quotes-template.csv" download className="inline-block text-body-sm font-semibold text-link hover:underline">Download a template CSV</a>
              <div className="flex justify-end"><SubmitButton icon="upload">Import quotes</SubmitButton></div>
            </ActionForm>
          </ModalButton>
          <ModalButton label="Add quote" title="Add quote" icon="add">{quoteForm()}</ModalButton></div></div>
        <Table>
          <thead><tr><Th>Quote</Th><Th>Author</Th><Th>Category</Th><Th>Shown</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{(data ?? []).map((q) => (
            <tr key={q.id}><Td className="max-w-md italic text-ink">“{q.text}”</Td><Td><div>{q.author}</div>{q.source && <div className="text-body-sm text-muted-text">{q.source}</div>}</Td>
              <Td><Badge tone="purple">{q.category.replace("_", " ")}</Badge></Td><Td>{counts.get(q.id) ?? 0}</Td>
              <Td><Badge tone={q.active ? "green" : "neutral"}>{q.active ? "Active" : "Inactive"}</Badge></Td>
              <Td className="text-right"><ModalButton label="Edit" title="Edit quote" icon="edit" variant="ghost" size="sm">{quoteForm(q)}</ModalButton></Td></tr>
          ))}</tbody>
        </Table>
      </Card>
    );
  }

  if (section === "lex") {
    const [settings, docs] = await Promise.all([supabase.from("system_settings").select("*").like("key", "lex.%"), supabase.from("knowledge_base_documents").select("*").order("title")]);
    const s = Object.fromEntries((settings.data ?? []).map((x) => [x.key, x.value]));
    const aiOn = Boolean(serverEnv().aiApiKey);
    const docForm = (d?: NonNullable<typeof docs.data>[number]) => (
      <ActionForm action={A.saveKbDoc} resetOnSuccess={!d} className="space-y-3">
        {d && <input type="hidden" name="id" value={d.id} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Slug *"><input name="slug" required defaultValue={d?.slug} className="input" /></Field>
          <Field label="Title *" className="sm:col-span-2"><input name="title" required defaultValue={d?.title} className="input" /></Field>
        </div>
        <Field label="Content *" hint="LEX answers only from approved articles."><textarea name="content" required rows={8} defaultValue={d?.content} className="input font-mono text-body-sm" /></Field>
        <Field label="In-app link"><input name="link" defaultValue={d?.link ?? ""} className="input" placeholder="/tasks" /></Field>
        <div><span className="label">Audience</span><div className="flex gap-4">{(["team_member", "administrator", "super_admin"] as const).map((r) => <Check key={r} name={`aud_${r}`} label={r.replace("_", " ")} checked={d ? d.audience.includes(r) : true} />)}</div></div>
        <Check name="active" label="Active" checked={d?.active ?? true} />
        <div className="flex justify-end"><SubmitButton icon="save">Save article</SubmitButton></div>
      </ActionForm>
    );
    body = (
      <div className="space-y-5">
        <Card className="p-5">
          <CardHeader icon="smart_toy" title="LEX assistant" action={<Badge tone={aiOn ? "green" : "amber"}>{aiOn ? `AI provider: ${serverEnv().aiProvider} · ${serverEnv().aiModel || "claude-opus-5-5"}` : "AI provider not configured — knowledge-base answers only"}</Badge>} />
          <ActionForm action={A.saveLexSettings} className="mt-4 space-y-3">
            <Check name="enabled" label="LEX is enabled for all users" checked={s["lex.enabled"] !== false} />
            <Field label="Welcome message"><textarea name="welcome" rows={2} maxLength={500} defaultValue={String(s["lex.welcome_message"] ?? "")} className="input" /></Field>
            <Field label="Conversation memory (previous messages sent as context)"><input name="max_history" type="number" min={0} max={24} defaultValue={Number(s["lex.max_history"] ?? 12)} className="input w-28" /></Field>
            <div className="flex justify-end"><SubmitButton icon="save">Save</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3"><CardHeader icon="library_books" title="Knowledge base" eyebrow="Role-filtered articles LEX may use" /><ModalButton label="Add article" title="Add knowledge base article" icon="add" wide>{docForm()}</ModalButton></div>
          <Table>
            <thead><tr><Th>Article</Th><Th>Audience</Th><Th>Updated</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{(docs.data ?? []).map((d) => (
              <tr key={d.id}><Td><div className="font-medium text-ink">{d.title}</div><div className="font-mono text-body-sm text-muted-text">{d.slug}</div></Td>
                <Td><div className="flex flex-wrap gap-1">{d.audience.map((a) => <Badge key={a}>{a.replace("_", " ")}</Badge>)}</div></Td>
                <Td className="text-body-sm text-muted-text">{fmtDateTime(d.updated_at)}</Td><Td><Badge tone={d.active ? "green" : "neutral"}>{d.active ? "Active" : "Inactive"}</Badge></Td>
                <Td className="text-right"><ModalButton label="Edit" title="Edit article" icon="edit" variant="ghost" size="sm" wide>{docForm(d)}</ModalButton></Td></tr>
            ))}</tbody>
          </Table>
        </Card>
      </div>
    );
  }

  if (section === "categories") {
    const [tc, sc] = await Promise.all([supabase.from("task_categories").select("*").order("kind").order("name"), supabase.from("service_categories").select("*").order("name")]);
    body = (
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader icon="label" title="Task categories" action={<ModalButton label="Add" title="Add task category" icon="add" size="sm">
            <ActionForm action={A.saveCategory} resetOnSuccess className="space-y-3"><input type="hidden" name="type" value="task" />
              <Field label="Name"><input name="name" required className="input" /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="List"><select name="kind" className="input"><option value="daily">Daily to-do</option><option value="additional">Additional task</option></select></Field><Field label="Colour"><input name="color" type="color" defaultValue="#5a45cb" className="h-10 w-full rounded-lg" /></Field></div>
              <Check name="active" label="Active" checked /><div className="flex justify-end"><SubmitButton>Save</SubmitButton></div></ActionForm></ModalButton>} />
          <ul className="mt-3 divide-y divide-border-subtle">{(tc.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded" style={{ background: c.color }} />{c.name}<Badge>{c.kind}</Badge>{!c.active && <Badge tone="neutral">inactive</Badge>}</span>
              <ModalButton label="Edit" title="Edit category" icon="edit" variant="ghost" size="sm"><ActionForm action={A.saveCategory} className="space-y-3"><input type="hidden" name="type" value="task" /><input type="hidden" name="id" value={c.id} />
                <Field label="Name"><input name="name" defaultValue={c.name} required className="input" /></Field>
                <div className="grid grid-cols-2 gap-3"><Field label="List"><select name="kind" defaultValue={c.kind} className="input"><option value="daily">Daily to-do</option><option value="additional">Additional task</option></select></Field><Field label="Colour"><input name="color" type="color" defaultValue={c.color} className="h-10 w-full rounded-lg" /></Field></div>
                <Check name="active" label="Active" checked={c.active} /><div className="flex justify-end"><SubmitButton>Save</SubmitButton></div></ActionForm></ModalButton></li>
          ))}</ul>
        </Card>
        <Card className="p-5">
          <CardHeader icon="design_services" title="Service categories" action={<ModalButton label="Add" title="Add service category" icon="add" size="sm">
            <ActionForm action={A.saveCategory} resetOnSuccess className="space-y-3"><input type="hidden" name="type" value="service" />
              <Field label="Name"><input name="name" required className="input" /></Field><Field label="Keywords (comma separated)"><input name="keywords" className="input" /></Field>
              <Check name="active" label="Active" checked /><div className="flex justify-end"><SubmitButton>Save</SubmitButton></div></ActionForm></ModalButton>} />
          <ul className="mt-3 divide-y divide-border-subtle">{(sc.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2"><span><span className="text-ink">{c.name}</span>{!c.active && <Badge tone="neutral" className="ml-1">inactive</Badge>}<span className="block text-body-sm text-muted-text">{c.keywords.join(", ") || "—"}</span></span>
              <ModalButton label="Edit" title="Edit category" icon="edit" variant="ghost" size="sm"><ActionForm action={A.saveCategory} className="space-y-3"><input type="hidden" name="type" value="service" /><input type="hidden" name="id" value={c.id} />
                <Field label="Name"><input name="name" defaultValue={c.name} required className="input" /></Field><Field label="Keywords"><input name="keywords" defaultValue={c.keywords.join(", ")} className="input" /></Field>
                <Check name="active" label="Active" checked={c.active} /><div className="flex justify-end"><SubmitButton>Save</SubmitButton></div></ActionForm></ModalButton></li>
          ))}</ul>
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader eyebrow="System" title="System Settings" description="Organisation-wide configuration. Every change is recorded in the audit log." />
      <Tabs active={section} items={SECTIONS.map((s) => ({ ...s, href: s.key === "general" ? "/settings" : `/settings/${s.key}` }))} />
      {body}
    </>
  );
}
