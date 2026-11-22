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
