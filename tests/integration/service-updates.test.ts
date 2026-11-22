import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
const aiCalls = { n: 0, failAfter: Infinity };
vi.mock("@/server/ai/provider", () => ({
  getAIProvider: () => ({
    name: "fake", model: "fake-model",
    complete: async () => {
      aiCalls.n++;
      await new Promise((r) => setTimeout(r, 1500));
      if (aiCalls.n > aiCalls.failAfter) throw new Error("429 busy");
      return "SUMMARY: A short neutral summary.\nACTION: Review your pricing page.";
    },
  }),
}));

import { service } from "./helpers";
import { ingestServiceUpdates, mapLimit, summariseBacklog } from "@/server/serviceUpdates";

const tag = Date.now().toString(36);
const rss = (n: number) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed ${n}</title>${Array.from({ length: 20 }, (_, i) =>
  `<item><title>Article ${n}-${i} ${tag}</title><link>https://news${n}.example.com/${tag}/a${i}</link><pubDate>Mon, 23 Nov 2026 10:00:00 GMT</pubDate><description>Excerpt ${i}</description></item>`).join("")}</channel></rss>`;

let sourceIds: string[] = [];
beforeAll(async () => {
  vi.stubGlobal("fetch", (async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("https://feed")) {
      await new Promise((r) => setTimeout(r, 1000)); // every feed takes 1 s
      const n = Number(String(url).match(/feed(\d+)/)![1]);
      return new Response(rss(n), { status: 200, headers: { "Content-Type": "application/rss+xml" } });
    }
    return (globalThis as unknown as { __realFetch: typeof fetch }).__realFetch(url, init);
  }) as typeof fetch);
  const { data: cat } = await service.from("service_categories").select("id").eq("slug", "digital-marketing").single();
  await service.from("service_update_sources").update({ active: false }).neq("feed_url", "");
  const { data } = await service.from("service_update_sources").insert(Array.from({ length: 18 }, (_, n) => ({
    name: `Test feed ${n} ${tag}`, feed_url: `https://feed${n}.example.com/${tag}.xml`, category_id: cat!.id,
  }))).select("id");
  sourceIds = data!.map((d) => d.id);
});
(globalThis as unknown as { __realFetch: typeof fetch }).__realFetch = globalThis.fetch;

afterAll(async () => {
  await service.from("service_updates").delete().in("source_id", sourceIds);
  await service.from("service_update_sources").delete().in("id", sourceIds);
  await service.from("service_update_sources").update({ active: true }).neq("feed_url", "");
  vi.unstubAllGlobals();
});

describe("service update ingestion", () => {
  it("runs work with bounded concurrency", async () => {
    let live = 0, peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 6, async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 20)); live--; });
    expect(peak).toBe(6);
  });

  it("fetches 18 slow feeds (360 articles) in seconds, without AI calls, and is idempotent", async () => {
    const t0 = Date.now();
    const r = await ingestServiceUpdates();
    const secs = (Date.now() - t0) / 1000;
    expect(r.sources).toHaveLength(18);
    expect(r.sources.every((s) => s.status === "ok")).toBe(true);
    expect(r.sources.reduce((a, s) => a + s.added, 0)).toBe(360);
    expect(secs).toBeLessThan(10);     // 18 × 1 s sequentially would be ≥ 18 s
    expect(aiCalls.n).toBe(0);         // no summaries during the click
    const again = await ingestServiceUpdates();
    expect(again.sources.reduce((a, s) => a + s.added, 0)).toBe(0); // duplicates skipped
  });

  it("summarises a small batch within the time budget and stops when the AI is busy", async () => {
    aiCalls.n = 0;
    const t0 = Date.now();
    const r = await summariseBacklog(20_000, 25); // 1.5 s per item; must stop before ~8 s of a 20 s budget minus 12 s margin
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.summarised).toBeGreaterThan(0);
    const { count } = await service.from("service_updates").select("id", { count: "exact", head: true }).in("source_id", sourceIds).not("ai_summary", "is", null);
    expect(count).toBe(r.summarised);
    aiCalls.n = 0; aiCalls.failAfter = 1;
    const busy = await summariseBacklog(60_000, 25);
    expect(busy.summarised).toBe(1); // stopped cleanly on the "busy" error
  }, 90_000);
});
