import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AIUnavailableError, geminiText, pickGeminiModel } from "@/server/ai/provider";

describe("Gemini response handling", () => {
  it("returns answer text and ignores thought parts", () => {
    expect(geminiText({ candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "Hello " }, { text: "there" }] }, finishReason: "STOP" }] })).toBe("Hello there");
  });
  it("treats blocked or empty responses as unavailable (LEX then falls back to help articles)", () => {
    expect(() => geminiText({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(AIUnavailableError);
    expect(() => geminiText({ candidates: [{ finishReason: "SAFETY" }] })).toThrow(AIUnavailableError);
    expect(() => geminiText({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] })).toThrow(AIUnavailableError);
  });
  it("picks a current stable text flash model when the configured one is retired", () => {
    const models = [
      { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.0-flash-preview", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    ];
    expect(pickGeminiModel(models)).toBe("gemini-2.5-flash");
    expect(pickGeminiModel([{ name: "models/gemini-9-flash-preview", supportedGenerationMethods: ["generateContent"] }])).toBe("gemini-9-flash-preview");
    expect(pickGeminiModel([])).toBeNull();
  });
});

describe("Gemini fallback behaviour", () => {
  it("retries, then falls back to another flash model when the preferred one is overloaded", async () => {
    const { getAIProvider } = await import("@/server/ai/provider");
    process.env.AI_PROVIDER = "gemini"; process.env.AI_API_KEY = "test-key"; process.env.AI_MODEL = "gemini-2.5-flash";
    const calls: string[] = [];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url).replace("https://generativelanguage.googleapis.com/v1beta/", ""));
      if (String(url).includes("/models?")) return json(200, { models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] } ] });
      if (String(url).includes("gemini-2.5-flash-lite")) return json(200, { candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] });
      return json(503, { error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded." } });
    }));
    const ai = getAIProvider()!;
    await expect(ai.complete({ system: "s", messages: [{ role: "user", content: "hi" }] })).resolves.toBe("OK");
    expect(calls.filter((c) => c.startsWith("models/gemini-2.5-flash:")).length).toBe(2); // retried once
    expect(calls.some((c) => c.startsWith("models/gemini-2.5-flash-lite:"))).toBe(true);
    expect(ai.model).toBe("gemini-2.5-flash-lite");
    vi.unstubAllGlobals();
  });
});

describe("Gemini timeouts", () => {
  it("treats a timeout as temporary and falls back instead of failing", async () => {
    const { getAIProvider } = await import("@/server/ai/provider");
    process.env.AI_PROVIDER = "gemini"; process.env.AI_API_KEY = "test-key"; process.env.AI_MODEL = "gemini-2.5-flash";
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/models?")) return json(200, { models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] } ] });
      bodies.push(JSON.parse(String(init?.body)));
      if (String(url).includes("flash-lite")) return json(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }] });
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }));
    await expect(getAIProvider()!.complete({ system: "s", messages: [{ role: "user", content: "hi" }] })).resolves.toBe("OK");
    // thinking is disabled for 2.5 flash models (faster answers)
    expect((bodies[0]!.generationConfig as { thinkingConfig?: { thinkingBudget: number } }).thinkingConfig?.thinkingBudget).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe("Gemini fallback order", () => {
  it("tries lite models before other full models", async () => {
    const { geminiFallbackOrder } = await import("@/server/ai/provider");
    expect(geminiFallbackOrder(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.8-flash-lite", "gemini-3.6-flash-lite"]))
      .toEqual(["gemini-3.8-flash-lite", "gemini-3.6-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"]);
  });
});
