import { XMLParser } from "fast-xml-parser";

export type FeedItem = { title: string; url: string; published_at: string | null; excerpt: string | null };

const strip = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const text = (v: unknown): string => typeof v === "object" && v !== null ? text((v as Record<string, unknown>)["#text"] ?? "") : String(v ?? "");

export function parseFeed(xml: string): FeedItem[] {
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

