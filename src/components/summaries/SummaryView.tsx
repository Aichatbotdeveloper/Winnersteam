import { Badge, ButtonLink, Card, Icon, Progress, StatTile, Table, Td, Th, scoreColor } from "@/components/ui";
import { LIST_NAME, SCOPE_LABEL, periodLabel } from "@/lib/summaries";
import { consequenceText } from "@/lib/labels";
import type { MemberStats, OrgStats, TeamStats } from "@/server/summaries";

export type SummaryRow = { id: string; scope: string; period_type: string; period_start: string; period_end: string; stats: unknown; ai_text: string | null; ai_used: boolean; created_at: string };

const pc = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
function Change({ v }: { v: number | null }) {
  if (v === null) return null;
  const up = v >= 0;
  return <span className={up ? "text-on-tertiary-container" : "text-accent-red"}>{up ? "▲" : "▼"} {Math.abs(v)} pts vs previous</span>;
}

export function SummaryView({ s }: { s: SummaryRow }) {
  const p = s.period_type === "weekly" ? "week" : "month";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><Badge tone="purple">{SCOPE_LABEL[s.scope]}</Badge><Badge tone="neutral">{s.period_type === "weekly" ? "Weekly" : "Monthly"}</Badge></div>
          <h2 className="mt-2 font-heading text-heading-lg text-ink">{periodLabel(s.period_type, s.period_start, s.period_end)}</h2>
        </div>
        <ButtonLink href={`/api/summaries/${s.id}/pdf`} variant="outline" icon="picture_as_pdf" size="sm">Download PDF</ButtonLink>
      </div>

      {s.ai_text && (
        <div className="rounded-xl border border-secondary/30 bg-surface-container-low p-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-secondary"><Icon name="auto_awesome" className="text-[16px]" />{s.ai_used ? "Your coach's note · written by LEX from your numbers" : "Summary note"}</div>
          <p className="text-body-lg leading-relaxed text-ink">{s.ai_text}</p>
        </div>
      )}

      {s.scope === "member" && (() => {
        const m = s.stats as MemberStats;
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={`Average this ${p}`} value={pc(m.average)} sub={<Change v={m.change} />} icon="monitoring" tone="purple" />
              <StatTile label="Checklists graded" value={`${m.graded}/${m.checklists}`} sub={`${m.submittedEarly} submitted early`} icon="checklist" tone="blue" />
              <StatTile label="Passed (no consequence)" value={m.passed} sub={`${m.belowPass} below the pass mark`} icon="verified" tone="green" />
              <StatTile label="Spins" value={m.spins} sub={m.unspun ? `${m.unspun} waiting` : "None waiting"} icon="casino" tone={m.unspun ? "amber" : "neutral"} />
            </div>
            <Card className="p-5">
              <h3 className="font-heading text-heading-md text-ink">By list type</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {Object.entries(m.byKind).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-surface-alt/60 p-3">
                    <div className="flex justify-between text-body-md"><span className="text-ink">{LIST_NAME[k]}</span><strong className="text-ink">{pc(v?.average)}</strong></div>
                    <Progress value={v?.average ?? 0} color={scoreColor(v?.average)} className="mt-2" />
                    <div className="mt-1 text-body-sm text-muted-text">{v?.count} checklist{v?.count === 1 ? "" : "s"}{k === m.best ? " · strongest" : k === m.weakest ? " · needs attention" : ""}</div>
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-1 text-body-md text-muted-text">
                {m.weakestDay && <li>• Your lowest-scoring day was <strong className="text-ink">{m.weakestDay}</strong>.</li>}
                {m.outcomes.length > 0 && <li>• Outcomes: {m.outcomes.map((o) => consequenceText(o.category as never, o.quantity)).join(", ")}.</li>}
                {m.finesUnpaid > 0 && <li>• {m.finesUnpaid} fine{m.finesUnpaid === 1 ? "" : "s"} not yet settled.</li>}
              </ul>
            </Card>
          </>
        );
      })()}

      {s.scope === "team" && (() => {
        const t = s.stats as TeamStats;
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Team average" value={pc(t.average)} sub={<Change v={t.change} />} icon="groups" tone="purple" />
              <StatTile label="Members" value={t.members} sub={`${t.activeMembers} used checklists`} icon="group" tone="blue" />
              <StatTile label="Top performer" value={t.top[0] ? pc(t.top[0].average) : "—"} sub={t.top[0]?.name ?? "—"} icon="emoji_events" tone="green" />
              <StatTile label="Need attention" value={t.attention.length} icon="flag" tone={t.attention.length ? "amber" : "neutral"} />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5"><h3 className="font-heading text-heading-md text-ink">Recognise</h3>
                <ol className="mt-3 space-y-2">{t.top.map((x, i) => <li key={x.name} className="flex justify-between rounded-lg bg-surface-alt/60 px-3 py-2"><span><span className="mr-2 text-muted-text">{i + 1}.</span>{x.name}</span><strong>{x.average}%</strong></li>)}
                  {!t.top.length && <li className="text-muted-text">No graded checklists this {p}.</li>}</ol></Card>
              <Card className="p-5"><h3 className="font-heading text-heading-md text-ink">Needs attention</h3>
                <ul className="mt-3 space-y-2">{t.attention.map((x) => <li key={x.name} className="rounded-lg bg-accent-amber/10 px-3 py-2"><div className="text-ink">{x.name}</div><div className="text-body-sm text-muted-text">{x.reasons.join(" · ")}</div></li>)}
                  {!t.attention.length && <li className="text-muted-text">Everyone is on track.</li>}</ul></Card>
            </div>
            <Card className="overflow-hidden"><Table><thead><tr><Th>Member</Th><Th>Checklists</Th><Th>Average</Th></tr></thead>
              <tbody>{t.ranking.map((x) => <tr key={x.userId}><Td className="text-ink">{x.name}</Td><Td>{x.checklists}</Td><Td><span style={{ color: scoreColor(x.average) }} className="font-semibold">{pc(x.average)}</span></Td></tr>)}</tbody></Table></Card>
          </>
        );
      })()}

      {s.scope === "organisation" && (() => {
        const o = s.stats as OrgStats;
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Organisation average" value={pc(o.average)} sub={<Change v={o.change} />} icon="corporate_fare" tone="purple" />
              <StatTile label="Members" value={o.members} icon="group" tone="blue" />
              <StatTile label="Used checklists" value={o.activeMembers} icon="checklist" tone="green" />
              <StatTile label="Did not use checklists" value={o.inactive} icon="person_off" tone={o.inactive ? "amber" : "neutral"} />
            </div>
            <Card className="overflow-hidden"><Table><thead><tr><Th>Administrator&apos;s team</Th><Th>Members</Th><Th>Average</Th></tr></thead>
              <tbody>{o.teams.filter((x) => x.average !== null).map((x) => <tr key={x.name}><Td className="text-ink">{x.name}</Td><Td>{x.members}</Td><Td><span style={{ color: scoreColor(x.average) }} className="font-semibold">{pc(x.average)}</span></Td></tr>)}</tbody></Table>
              {o.teams.some((x) => x.average === null) && <p className="border-t border-border-subtle px-4 py-3 text-body-sm text-muted-text">{o.teams.filter((x) => x.average === null).length} other team(s) had no graded checklists.</p>}</Card>
          </>
        );
      })()}
    </div>
  );
}
