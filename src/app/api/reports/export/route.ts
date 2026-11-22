import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCurrentProfile } from "@/lib/auth";
import { buildReport, type Report } from "@/server/reports";
import { todayInOrg } from "@/lib/format";

export const maxDuration = 60;

function csvCell(v: unknown) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula-injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function toXlsx(r: Report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Winners Team";
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]);
  ws.addRow([]);
  const head = ws.addRow(r.columns);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A45CB" } }; });
  for (const row of r.rows) ws.addRow(row.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v)));
  ws.columns.forEach((c) => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function toPdf(r: Report) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 32; // A4 landscape
  const cols = r.columns.length;
  const colW = (W - 2 * M) / cols;
  const size = cols > 12 ? 6 : cols > 8 ? 7 : 8;
  const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, (ch) => (ch === "₦" ? "NGN " : ch === "—" || ch === "–" ? "-" : "?"));
  const fit = (s: string, f = font) => { let t = safe(s); while (t.length > 1 && f.widthOfTextAtSize(t, size) > colW - 4) t = t.slice(0, -2) + "…".replace("…", "."); return t; };
  let page = pdf.addPage([W, H]); let y = H - M;
  const header = () => {
    page.drawText(safe(`Winners Team · ${r.title}`), { x: M, y, size: 14, font: bold, color: rgb(0.035, 0.047, 0.11) }); y -= 16;
    page.drawText(safe(`${r.subtitle} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`), { x: M, y, size: 8, font, color: rgb(0.29, 0.33, 0.39) }); y -= 18;
    page.drawRectangle({ x: M, y: y - 3, width: W - 2 * M, height: 14, color: rgb(0.353, 0.271, 0.796) });
    r.columns.forEach((c, i) => page.drawText(fit(c, bold), { x: M + i * colW + 2, y, size, font: bold, color: rgb(1, 1, 1) }));
    y -= 15;
  };
  header();
  r.rows.forEach((row, idx) => {
    if (y < M + 10) { page = pdf.addPage([W, H]); y = H - M; header(); }
    if (idx % 2) page.drawRectangle({ x: M, y: y - 3, width: W - 2 * M, height: 12, color: rgb(0.953, 0.957, 0.965) });
    row.forEach((v, i) => page.drawText(fit(v === null || v === undefined ? "-" : String(v)), { x: M + i * colW + 2, y, size, font, color: rgb(0.12, 0.16, 0.22) }));
    y -= 12;
  });
  if (r.rows.length === 0) page.drawText("No records.", { x: M, y, size: 10, font });
  return Buffer.from(await pdf.save());
}

export async function GET(req: NextRequest) {
  const me = await getCurrentProfile();
  if (!me || me.status !== "approved") return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "performance";
  const format = sp.get("format") ?? "csv";
  const period = (["daily", "weekly", "monthly"].includes(sp.get("period") ?? "") ? sp.get("period") : "weekly") as "daily" | "weekly" | "monthly";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("date") ?? "") ? sp.get("date")! : todayInOrg();
  const admin = me.role === "super_admin" && /^[0-9a-f-]{36}$/.test(sp.get("admin") ?? "") ? sp.get("admin") : null;
  let report: Report;
  try { report = await buildReport(me, type, period, date, admin); } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Report failed" }, { status: 400 });
  }
  const name = `winners-team-${type}-${period}-${date}`;
  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(await toXlsx(report)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
  }
  if (format === "pdf") {
    return new NextResponse(new Uint8Array(await toPdf(report)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store" } });
  }
  const csv = "﻿" + [report.columns, ...report.rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
}
