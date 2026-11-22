import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAIProvider } from "@/server/ai/provider";
import { parseFeed } from "@/lib/feed";


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

/** Fetch every active source, store new items, summarise (if AI configured) and match to users. */
// Identify like a standard feed reader (some publishers block unknown agents).
const FEED_USER_AGENT = "Mozilla/5.0 (compatible; WinnersTeamFeedReader/1.0; +https://winnersteam.automifyco.com)";

/** Turn low-level fetch errors ("fetch failed") into a readable reason (exported for tests). */
export function describeFetchError(e: unknown): string {
  if (!(e instanceof Error)) return "failed";
  const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? "";
  const reasons: Record<string, string> = {
    ENOTFOUND: "address not found (DNS)", EAI_AGAIN: "address lookup timed out (DNS)", ECONNREFUSED: "connection refused",
    ECONNRESET: "connection reset by the site", ETIMEDOUT: "connection timed out", UND_ERR_CONNECT_TIMEOUT: "connection timed out",
    CERT_HAS_EXPIRED: "the site's security certificate has expired", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "security certificate could not be verified",
    ERR_TLS_CERT_ALTNAME_INVALID: "security certificate does not match the address",
  };
  if (e.name === "TimeoutError") return "timed out after 15 s";
  const detail = reasons[code] ?? cause?.message ?? "";
  return `${e.message}${detail ? ` — ${detail}` : code ? ` (${code})` : ""}`.slice(0, 200);
}

/** Run async work over items with a fixed concurrency (exported for tests). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Fetch every active source (in parallel), store new items and deliver them to
 * matching members. Fast: no AI calls here — see summariseBacklog().
 */
export async function ingestServiceUpdates(onlySourceId?: string) {
  const db = createAdminClient();
  const { data: maxSetting } = await db.from("system_settings").select("value").eq("key", "service_updates.max_items_per_source").maybeSingle();
  const max = Math.min(Math.max(Number(maxSetting?.value ?? 20), 1), 50);
  let q = db.from("service_update_sources").select("*, category:service_categories(name)").eq("active", true);
  if (onlySourceId) q = q.eq("id", onlySourceId);
  const { data: sources } = await q;

  const report = await mapLimit(sources ?? [], 6, async (s) => {
    let added = 0; let status = "ok";
    try {
      await assertPublicUrl(s.feed_url);
      const res = await fetch(s.feed_url, { headers: { "User-Agent": FEED_USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5", "Accept-Language": "en" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.text()).slice(0, 3_000_000);
      const items = parseFeed(body).filter((i) => i.title && /^https?:\/\//.test(i.url)).slice(0, max);
      const catName = (s.category as unknown as { name: string } | null)?.name ?? "your services";
      if (items.length) {
        const { data, error } = await db.from("service_updates").upsert(items.map((it) => ({
          source_id: s.id, category_id: s.category_id, title: it.title.slice(0, 500), url: it.url, published_at: it.published_at,
          excerpt: it.excerpt, relevance_note: `Published by ${s.name}, an approved ${catName} source.`,
        })), { onConflict: "url", ignoreDuplicates: true }).select("id");
        if (error) throw new Error(`save failed: ${error.message}`);
        added = data?.length ?? 0;
      }
    } catch (e) {
      status = describeFetchError(e);
    }
    await db.from("service_update_sources").update({ last_fetched_at: new Date().toISOString(), last_status: status }).eq("id", s.id);
    return { source: s.name as string, status, added };
  });
  const { data: matched } = await db.rpc("cron_match_service_updates");
  return { sources: report, matched: matched ?? 0, ai: Boolean(getAIProvider()) };
}

/**
 * Add AI summaries to recent items that have none, newest first, within a time
 * budget and stopping early when the AI service is busy (free-tier friendly).
 * Unsummarised items simply show their original excerpt until a later run.
 */
export async function summariseBacklog(budgetMs: number, maxItems = 12) {
  const ai = getAIProvider();
  if (!ai) return { summarised: 0, ai: false };
  const db = createAdminClient();
  const started = Date.now();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: items } = await db.from("service_updates").select("id,title,excerpt,category:service_categories(name)")
    .is("ai_summary", null).is("summary_model", null).not("excerpt", "is", null).gte("fetched_at", since)
    .order("published_at", { ascending: false, nullsFirst: false }).limit(maxItems);
  let summarised = 0;
  for (const it of items ?? []) {
    if (Date.now() - started > budgetMs - 12_000) break;
    try {
      const out = await ai.complete({
        system: "You summarise professional industry news for a small services team. Use ONLY the supplied title and excerpt; never add facts. Reply in exactly two lines:\nSUMMARY: <one or two sentences>\nACTION: <one practical suggestion for a professional offering this service, or 'None'>",
        messages: [{ role: "user", content: `Service category: ${(it.category as unknown as { name: string } | null)?.name ?? "General"}\nTitle: ${it.title}\nExcerpt: ${it.excerpt}` }],
        maxTokens: 400, effort: "low",
      });
      const summary = out.match(/SUMMARY:\s*(.+)/)?.[1]?.trim() ?? null;
      const act = out.match(/ACTION:\s*(.+)/)?.[1]?.trim();
      await db.from("service_updates").update({
        ai_summary: summary, recommended_action: act && act.toLowerCase() !== "none" ? act : null,
        // Mark as processed even if the reply had no SUMMARY line, so it is not retried forever.
        summary_model: summary ? ai.model : "unparsed",
      }).eq("id", it.id);
      if (summary) summarised++;
    } catch {
      break; // AI busy or unavailable: stop now, the next run continues.
    }
  }
  return { summarised, ai: true };
}
