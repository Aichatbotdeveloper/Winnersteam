import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildReport } from "@/server/reports";
import { Badge, Card, CardHeader, Icon, PageHeader, StatTile, Table, Td, Th, buttonClass } from "@/components/ui";
import { pct, todayInOrg } from "@/lib/format";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ type?: string; period?: string; date?: string; admin?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const common = [["checklists", "Checklists"], ["checklist_items", "Checklist items"], ["development", "Personal development"], ["accountability", "Accountability"]];
  const types = me.role === "team_member" ? [["performance", "Performance history"], ...common]
    : [["performance", "Team performance"], ...common, ["users", "User directory"]];
  const type = types.some(([k]) => k === sp.type) ? sp.type! : "performance";
  const period = (["daily", "weekly", "monthly"].includes(sp.period ?? "") ? sp.period : "weekly") as "daily" | "weekly" | "monthly";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayInOrg();
  const admin = me.role === "super_admin" && sp.admin ? sp.admin : null;
  const report = await buildReport(me, type, period, date, admin);
  const admins = me.role === "super_admin" ? (await (await createClient()).rpc("list_administrators")).data ?? [] : [];
  const qs = new URLSearchParams({ type, period, date, ...(admin ? { admin } : {}) }).toString();
  const overallIdx = report.columns.findIndex((c) => c.startsWith("Overall"));
  const scores = overallIdx >= 0 ? report.rows.map((r) => r[overallIdx]).filter((v): v is number => typeof v === "number") : [];
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return (
    <>
      <PageHeader eyebrow={me.role === "super_admin" ? "Organisation-wide reports" : me.role === "administrator" ? "Assigned-team reports" : "Individual reports"} title="Reports & Exports"
        description="Reports include only the records you are authorised to see. Export to CSV, Excel or PDF."
        actions={<>
          {(["csv", "xlsx", "pdf"] as const).map((f) => <a key={f} href={`/api/reports/export?${qs}&format=${f}`} className={buttonClass(f === "csv" ? "primary" : "outline")}><Icon name="download" className="text-[18px]" />{f.toUpperCase()}</a>)}
        </>} />
      <Card className="mb-5 p-4">
        <form className="flex flex-wrap items-end gap-3" action="/reports">
          <label><span className="label">Report</span><select name="type" defaultValue={type} className="input w-auto">{types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label><span className="label">Period</span><select name="period" defaultValue={period} className="input w-auto"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          <label><span className="label">Date in period</span><input type="date" name="date" defaultValue={date} className="input w-auto" /></label>
          {me.role === "super_admin" && (
            <label><span className="label">Administrator</span><select name="admin" defaultValue={admin ?? ""} className="input w-auto"><option value="">All administrators</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}</select></label>
          )}
          <button className={buttonClass("secondary")}><Icon name="refresh" className="text-[18px]" />Run report</button>
        </form>
      </Card>
      {overallIdx >= 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <StatTile label="Rows" value={report.rows.length} icon="table_rows" />
          <StatTile label="Average overall" value={pct(avg)} icon="monitoring" tone="blue" />
          <StatTile label="Below 50%" value={scores.filter((s) => s < 50).length} icon="warning" tone="red" />
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="p-5 pb-3"><CardHeader icon="summarize" title={report.title} eyebrow={report.subtitle} /></div>
        <Table>
          <thead><tr>{report.columns.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
          <tbody>
            {report.rows.length === 0 && <tr><Td colSpan={report.columns.length} className="py-8 text-center text-muted-text">No records for this selection.</Td></tr>}
            {report.rows.slice(0, 300).map((r, i) => (
              <tr key={i}>{r.map((v, j) => <Td key={j} className={j === 0 ? "font-medium text-ink" : "text-muted-text"}>
                {j === overallIdx && typeof v === "number" ? <Badge tone={v >= 90 ? "green" : v >= 75 ? "blue" : v >= 50 ? "amber" : "red"}>{pct(v)}</Badge> : v === null || v === undefined ? "—" : String(v)}
              </Td>)}</tr>
            ))}
          </tbody>
        </Table>
        {report.rows.length > 300 && <p className="px-5 py-3 text-body-sm text-muted-text">Showing the first 300 of {report.rows.length} rows — export for the full report.</p>}
      </Card>
    </>
  );
}
