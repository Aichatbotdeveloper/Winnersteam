import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseFeed } from "@/lib/feed";
import { csvCell } from "@/lib/csv";
import { addDays, monthEnd, monthStart, pct, weekStart, naira } from "@/lib/format";
import { CONSEQUENCE_LIMITS, CONSEQUENCE_LABEL, consequenceText } from "@/lib/labels";

describe("feed parser", () => {
  it("parses RSS 2.0 and strips HTML", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
      <item><title>Hello &amp; welcome</title><link>https://example.com/a</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Body &lt;b&gt;text&lt;/b&gt;&lt;/p&gt;</description></item>
      <item><title>Second</title><link>https://example.com/b</link></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Hello & welcome", url: "https://example.com/a", excerpt: "Body text" });
    expect(items[0]!.published_at).toBe("2026-11-02T10:00:00.000Z");
    expect(items[1]!.published_at).toBeNull();
  });
  it("parses Atom", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://e.com/1"/><updated>2026-11-01T00:00:00Z</updated><summary>Sum</summary></entry></feed>`;
    expect(parseFeed(xml)[0]).toMatchObject({ title: "A", url: "https://e.com/1", excerpt: "Sum" });
  });
  it("rejects non-feeds", () => {
    expect(() => parseFeed("<html></html>")).toThrow();
  });
});

describe("csv export", () => {
  it("guards against formula injection and quotes", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
});

describe("period helpers", () => {
  it("weeks start on Monday, months on the 1st", () => {
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday → Monday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(monthStart("2026-11-22")).toBe("2026-11-01");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("formats percentages and naira", () => {
    expect(pct(80)).toBe("80%");
    expect(pct(81.666, 1)).toBe("81.7%");
    expect(pct(null)).toBe("—");
    expect(naira(5000)).toContain("5,000");
  });
});

describe("accountability business rules (UI mirror of DB constraints)", () => {
  it("has exactly four categories with the mandated limits", () => {
    expect(Object.keys(CONSEQUENCE_LABEL).sort()).toEqual(["financial_fine", "frog_jumps", "leg_raising", "office_signatures"]);
    expect(CONSEQUENCE_LIMITS.frog_jumps).toMatchObject({ min: 10, max: 400, physical: true });
    expect(CONSEQUENCE_LIMITS.leg_raising).toMatchObject({ min: 10, max: 60, physical: true });
    expect(CONSEQUENCE_LIMITS.office_signatures).toMatchObject({ min: 1, max: 10, physical: false });
    expect(CONSEQUENCE_LIMITS.financial_fine).toMatchObject({ min: 200, max: 5000, unit: "NGN", physical: false });
    expect(consequenceText("financial_fine", 2500)).toBe("₦2,500 financial fine");
  });
});

describe("csv parser", () => {
  it("handles quotes, commas, escaped quotes and CRLF", async () => {
    const { parseCsv } = await import("@/lib/csv");
    expect(parseCsv('﻿text,author\r\n"Hello, ""world""",Ann\r\n\r\nPlain,Bob')).toEqual([["text", "author"], ['Hello, "world"', "Ann"], ["Plain", "Bob"]]);
  });
});

describe("feed fetch error messages", () => {
  it("explains low-level network failures", async () => {
    const { describeFetchError } = await import("@/server/serviceUpdates");
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND x" } });
    expect(describeFetchError(err)).toBe("fetch failed — address not found (DNS)");
    expect(describeFetchError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("timed out after 15 s");
    expect(describeFetchError(new Error("HTTP 403"))).toBe("HTTP 403");
  });
});

import { checklistLabel } from "@/lib/checklists";
describe("checklist labels", () => {
  it("never repeats words the title already ends with", () => {
    expect(checklistLabel("Office", "todo")).toBe("Office to-do list");
    expect(checklistLabel("Home to-do list", "todo")).toBe("Home to-do list");
    expect(checklistLabel("Daily to-do", "todo")).toBe("Daily to-do list");
    expect(checklistLabel("Prospecting", "prospecting")).toBe("Prospecting list");
    expect(checklistLabel("Sales weekly", "weekly")).toBe("Sales weekly goals");
  });
});
