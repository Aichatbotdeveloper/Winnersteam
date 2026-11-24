import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LIST_NAME, SCOPE_LABEL, periodLabel } from "@/lib/summaries";
import type { MemberStats, OrgStats, TeamStats } from "@/server/summaries";

const safe = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, "-").replace(/₦/g, "NGN ").replace(/[▲]/g, "+").replace(/[▼]/g, "-").replace(/[^\x20-\x7E]/g, "");
const pc = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${v}%`);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentProfile();
  if (!me) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: s } = await supabase.from("performance_summaries").select("*").eq("id", id).maybeSingle();
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  const M = 50, W = 595 - 2 * M;
  let y = 790;
  const line = (text: string, o: { size?: number; b?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
    const size = o.size ?? 11, f = o.b ? bold : font;
    const words = safe(text).split(" "); let cur = "";
    const flush = () => { if (y < 60) { page = pdf.addPage([595, 842]); y = 790; } page.drawText(cur, { x: M, y, size, font: f, color: rgb(...(o.color ?? [0.09, 0.1, 0.17])) }); y -= size + 5; cur = ""; };
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, size) > W) { flush(); cur = w; } else cur = t; }
    if (cur) flush();
    y -= o.gap ?? 0;
  };
  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: rgb(0.353, 0.271, 0.796) });
  page.drawText("Winners Team", { x: M, y: 822, size: 12, font: bold, color: rgb(1, 1, 1) });
  y = 780;
  line(`${SCOPE_LABEL[s.scope]} ${s.period_type} summary`, { size: 10, color: [0.35, 0.35, 0.4] });
  line(periodLabel(s.period_type, s.period_start, s.period_end), { size: 18, b: true, gap: 6 });
  line(`Prepared for ${me.full_name}`, { size: 10, color: [0.35, 0.35, 0.4], gap: 10 });
  if (s.ai_text) { line(s.ai_used ? "Coach's note (written by LEX from the numbers)" : "Summary note", { b: true }); line(s.ai_text, { gap: 12 }); }
  if (s.scope === "member") {
    const m = s.stats as MemberStats;
    line("Results", { b: true });
    line(`Average: ${pc(m.average)}${m.change !== null ? ` (${m.change >= 0 ? "+" : ""}${m.change} points vs previous)` : ""}`);
    line(`Checklists graded: ${m.graded} of ${m.checklists} (${m.submittedEarly} submitted early)`);
    line(`Passed: ${m.passed}  |  Below the pass mark: ${m.belowPass}  |  Spins: ${m.spins}`, { gap: 8 });
    line("By list type", { b: true });
    for (const [k, v] of Object.entries(m.byKind)) line(`${LIST_NAME[k]}: ${pc(v?.average)} (${v?.count} checklists)`);
    if (m.weakestDay) line(`Lowest-scoring day: ${m.weakestDay}`);
  } else if (s.scope === "team") {
    const t = s.stats as TeamStats;
    line(`Team average: ${pc(t.average)}${t.change !== null ? ` (${t.change >= 0 ? "+" : ""}${t.change} points)` : ""}  |  Members: ${t.members} (${t.activeMembers} active)`, { gap: 8 });
    line("Recognise", { b: true }); t.top.forEach((x, i) => line(`${i + 1}. ${x.name} - ${x.average}%`)); y -= 6;
    line("Needs attention", { b: true }); (t.attention.length ? t.attention : [{ name: "Nobody", reasons: ["everyone is on track"] }]).forEach((x) => line(`${x.name}: ${x.reasons.join(", ")}`)); y -= 6;
    line("All members", { b: true }); t.ranking.forEach((x) => line(`${x.name}: ${pc(x.average)} (${x.checklists} checklists)`, { size: 10 }));
  } else {
    const o = s.stats as OrgStats;
    line(`Organisation average: ${pc(o.average)}${o.change !== null ? ` (${o.change >= 0 ? "+" : ""}${o.change} points)` : ""}`);
    line(`Members: ${o.members}  |  Used checklists: ${o.activeMembers}  |  Did not: ${o.inactive}`, { gap: 8 });
    line("Teams", { b: true }); o.teams.filter((x) => x.average !== null).forEach((x) => line(`${x.name}'s team: ${pc(x.average)} (${x.members} members)`, { size: 10 }));
  }
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="winners-team-${s.period_type}-summary-${s.period_start}.pdf"`,
    "Cache-Control": "private, no-store" } });
}
