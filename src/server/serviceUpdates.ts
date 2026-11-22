import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAIProvider } from "@/server/ai/provider";

type Item = { title: string; url: string; published_at: string | null; excerpt: string | null };

function isPrivateIp(ip: string) {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i.test(ip);
}

/** Guard against SSRF: only public https hosts may be fetched. */
async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error("Only https feeds are allowed");
  const host = u.hostname;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Feed host resolves to a private address");
}

const strip = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const text = (v: unknown): string => typeof v === "object" && v !== null ? text((v as Record<string, unknown>)["#text"] ?? "") : String(v ?? "");

export function parseFeed(xml: string): Item[] {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(xml);
  const arr = <T,>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  if (doc.rss?.channel) {
    return arr(doc.rss.channel.item).map((i: Record<string, unknown>) => ({
      title: strip(text(i.title)), url: text(i.link).trim(),
      published_at: i.pubDate ? new Date(text(i.pubDate)).toISOString() : null,
      excerpt: strip(text(i.description)).slice(0, 600) || null,
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e: Record<string, unknown>) => {
      const links = arr(e.link as Record<string, string> | Record<string, string>[]);
      const link = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
      const date = text(e.published ?? e.updated);
      return { title: strip(text(e.title)), url: (link?.["@href"] ?? "").trim(), published_at: date ? new Date(date).toISOString() : null,
        excerpt: strip(text(e.summary ?? e.content)).slice(0, 600) || null };
    });
  }
  throw new Error("Not a recognised RSS or Atom feed");
}

/** Fetch every active source, store new items, summarise (if AI configured) and match to users. */
export async function ingestServiceUpdates(onlySourceId?: string) {
  const db = createAdminClient();
  const { data: maxSetting } = await db.from("system_settings").select("value").eq("key", "service_updates.max_items_per_source").maybeSingle();
  const max = Math.min(Math.max(Number(maxSetting?.value ?? 20), 1), 50);
  let q = db.from("service_update_sources").select("*, category:service_categories(name)").eq("active", true);
  if (onlySourceId) q = q.eq("id", onlySourceId);
  const { data: sources } = await q;
  const ai = getAIProvider();
  const report: { source: string; status: string; added: number }[] = [];

  for (const s of sources ?? []) {
    let added = 0; let status = "ok";
    try {
      await assertPublicUrl(s.feed_url);
      const res = await fetch(s.feed_url, { headers: { "User-Agent": "WinnersTeam-ServiceUpdates/1.0", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.text()).slice(0, 3_000_000);
      const items = parseFeed(body).filter((i) => i.title && /^https?:\/\//.test(i.url)).slice(0, max);
      const { data: existing } = await db.from("service_updates").select("url").in("url", items.map((i) => i.url));
      const seen = new Set((existing ?? []).map((e) => e.url));
      const catName = (s.category as unknown as { name: string } | null)?.name ?? "your services";
      for (const it of items.filter((i) => !seen.has(i.url))) {
        let ai_summary: string | null = null; let recommended_action: string | null = null;
        if (ai && it.excerpt) {
          try {
            const out = await ai.complete({
              system: "You summarise professional industry news for a small services team. Use ONLY the supplied title and excerpt; never add facts. Reply in exactly two lines:\nSUMMARY: <one or two sentences>\nACTION: <one practical suggestion for a professional offering this service, or 'None'>",
              messages: [{ role: "user", content: `Service category: ${catName}\nTitle: ${it.title}\nExcerpt: ${it.excerpt}` }], maxTokens: 400, effort: "low",
            });
            ai_summary = out.match(/SUMMARY:\s*(.+)/)?.[1]?.trim() ?? null;
            const act = out.match(/ACTION:\s*(.+)/)?.[1]?.trim();
            recommended_action = act && act.toLowerCase() !== "none" ? act : null;
          } catch { /* summary is optional; keep the original excerpt */ }
        }
        const { error } = await db.from("service_updates").insert({
          source_id: s.id, category_id: s.category_id, title: it.title.slice(0, 500), url: it.url, published_at: it.published_at,
          excerpt: it.excerpt, ai_summary, recommended_action, summary_model: ai_summary ? ai!.model : null,
          relevance_note: `Published by ${s.name}, an approved ${catName} source.`,
        });
        if (!error) added++;
      }
    } catch (e) {
      status = e instanceof Error ? e.message.slice(0, 200) : "failed";
    }
    await db.from("service_update_sources").update({ last_fetched_at: new Date().toISOString(), last_status: status }).eq("id", s.id);
    report.push({ source: s.name, status, added });
  }
  const { data: matched } = await db.rpc("cron_match_service_updates");
  return { sources: report, matched: matched ?? 0, ai: Boolean(ai) };
}
