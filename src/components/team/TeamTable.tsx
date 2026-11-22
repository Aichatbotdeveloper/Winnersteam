import Link from "next/link";
import { Avatar, Badge, EmptyState, Progress, Table, Td, Th, scoreColor } from "@/components/ui";
import { normalisePerformance } from "@/server/queries";
import { CATEGORY_LABEL } from "@/lib/labels";
import { pct } from "@/lib/format";

export type TeamRow = { user_id: string; full_name: string; job_title: string | null; administrator_name: string | null; overall: number | null; categories: unknown };

export function TeamTable({ rows, showAdmin = false, limit }: { rows: TeamRow[]; showAdmin?: boolean; limit?: number }) {
  if (rows.length === 0) return <EmptyState icon="groups" title="No team members yet">Members appear here once they are approved and assigned.</EmptyState>;
  const list = limit ? rows.slice(0, limit) : rows;
  return (
    <Table>
      <thead><tr><Th>Team member</Th>{showAdmin && <Th>Administrator</Th>}<Th>Overall</Th>{Object.values(CATEGORY_LABEL).map((c) => <Th key={c} className="hidden xl:table-cell">{c}</Th>)}<Th>Status</Th></tr></thead>
      <tbody>
        {list.map((r) => {
          const p = normalisePerformance({ overall: r.overall, categories: r.categories });
          return (
            <tr key={r.user_id} className="hover:bg-surface-alt/50">
              <Td><Link href={`/team/${r.user_id}`} className="flex items-center gap-2.5"><Avatar name={r.full_name} size={30} /><span><span className="block font-medium text-ink hover:underline">{r.full_name}</span><span className="text-body-sm text-muted-text">{r.job_title ?? "—"}</span></span></Link></Td>
              {showAdmin && <Td className="text-muted-text">{r.administrator_name ?? <Badge tone="amber">Unassigned</Badge>}</Td>}
              <Td><div className="flex w-28 items-center gap-2"><Progress value={p.overall ?? 0} color={scoreColor(p.overall)} /><span className="text-label-md">{pct(p.overall)}</span></div></Td>
              {p.categories.map((c) => <Td key={c.category} className="hidden text-muted-text xl:table-cell">{c.applicable ? pct(c.capped_pct) : "—"}</Td>)}
              <Td>{p.overall === null ? <Badge>No data</Badge> : p.overall >= 90 ? <Badge tone="green">On target</Badge> : p.overall >= 75 ? <Badge tone="blue">Low risk</Badge> : p.overall >= 50 ? <Badge tone="amber">Moderate</Badge> : <Badge tone="red">High risk</Badge>}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
