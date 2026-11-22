import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";

/**
 * Provider-agnostic AI interface used by LEX and service-update summaries.
 * Configure with AI_PROVIDER / AI_API_KEY / AI_MODEL (server-side only).
 * Supported: AI_PROVIDER=gemini (Google, free tier available) or anthropic (Claude).
 * To add another provider, implement `AIProvider` and register it in `getAIProvider()`.
 */
export type ChatTurn = { role: "user" | "assistant"; content: string };
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(opts: { system: string; messages: ChatTurn[]; maxTokens?: number; effort?: "low" | "medium" | "high" }): Promise<string>;
}

export class AIUnavailableError extends Error {}

class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }
  async complete({ system, messages, maxTokens = 4000, effort = "low" }: Parameters<AIProvider["complete"]>[0]) {
    try {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages,
        output_config: { effort },
        // Server-side refusal fallback (routes by refusal category).
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (res.stop_reason === "refusal") throw new AIUnavailableError("The assistant could not answer that request.");
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!text) throw new AIUnavailableError("The assistant returned an empty response.");
      return text;
    } catch (e) {
      if (e instanceof AIUnavailableError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AIUnavailableError("AI provider credentials are invalid.");
      if (e instanceof Anthropic.RateLimitError) throw new AIUnavailableError("The AI provider is busy. Please try again shortly.");
      if (e instanceof Anthropic.APIError) throw new AIUnavailableError(`AI provider error (${e.status ?? "network"}).`);
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Google Gemini (REST: generativelanguage.googleapis.com, works on the free tier)
// ---------------------------------------------------------------------------
type GeminiPart = { text?: string; thought?: boolean };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; status?: string; message?: string };
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
let discoveredGeminiModel: string | null = null;

/** Extract the answer text from a generateContent response (exported for tests). */
export function geminiText(res: GeminiResponse): string {
  if (res.promptFeedback?.blockReason) throw new AIUnavailableError("The assistant could not answer that request.");
  const c = res.candidates?.[0];
  if (!c) throw new AIUnavailableError("The assistant returned no answer.");
  if (c.finishReason && ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(c.finishReason)) {
    throw new AIUnavailableError("The assistant could not answer that request.");
  }
  const text = (c.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("").trim();
  if (!text) throw new AIUnavailableError("The assistant returned an empty response.");
  return text;
}

/** Choose a current text "flash" model when the configured name no longer exists. */
export function pickGeminiModel(models: { name: string; supportedGenerationMethods?: string[] }[]): string | null {
  const ok = models.filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /flash/.test(n) && !/(image|tts|audio|live|embedding|vision|exp|thinking)/.test(n));
  const stable = ok.filter((n) => !/preview/.test(n));
  const pool = stable.length ? stable : ok;
  // Prefer the newest version number, then the full (non-lite) model.
  const ver = (n: string) => Number(n.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  pool.sort((x, y) => ver(y) - ver(x) || Number(/lite/.test(x)) - Number(/lite/.test(y)) || x.length - y.length);
  return pool[0] ?? null;
}

class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  constructor(private apiKey: string, private configuredModel: string) {}
  get model() { return discoveredGeminiModel ?? this.configuredModel; }

  private async call(model: string, body: unknown) {
    return fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  }

  private async discover(): Promise<string | null> {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": this.apiKey }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return pickGeminiModel(data.models ?? []);
  }

  async complete({ system, messages, maxTokens = 2000 }: Parameters<AIProvider["complete"]>[0]) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: Math.max(maxTokens, 1024), temperature: 0.3 },
    };
    let res = await this.call(this.model, body);
    if (res.status === 404) {
      // Configured model was retired or renamed: pick a current one automatically.
      const next = await this.discover();
      if (!next) throw new AIUnavailableError("No Gemini model is available for this API key.");
      discoveredGeminiModel = next;
      res = await this.call(next, body);
    }
    if (res.status === 429) throw new AIUnavailableError("The AI service is busy (free-tier limit reached). Please try again shortly.");
    if (res.status === 400 || res.status === 403) {
      const err = (await res.json().catch(() => ({}))) as GeminiResponse;
      console.error("Gemini error", res.status, err.error?.status, err.error?.message);
      throw new AIUnavailableError(res.status === 403 ? "AI provider credentials are invalid." : "The AI request was rejected.");
    }
    if (!res.ok) throw new AIUnavailableError(`AI provider error (${res.status}).`);
    return geminiText((await res.json()) as GeminiResponse);
  }
}

export function getAIProvider(): AIProvider | null {
  const env = serverEnv();
  if (!env.aiApiKey) return null;
  switch (env.aiProvider) {
    case "anthropic":
      return new AnthropicProvider(env.aiApiKey, env.aiModel || "claude-opus-5-5");
    case "gemini":
      return new GeminiProvider(env.aiApiKey, env.aiModel || "gemini-2.5-flash");
    default:
      return null;
  }
}

/** Quick live check used by Settings → "Test AI connection". */
export async function testAIProvider() {
  const ai = getAIProvider();
  if (!ai) return { ok: false, message: "No AI provider is configured (AI_PROVIDER / AI_API_KEY)." };
  try {
    const reply = await ai.complete({ system: "Reply with exactly: OK", messages: [{ role: "user", content: "Connection test" }], maxTokens: 50, effort: "low" });
    return { ok: true, message: `${ai.name} is working (model: ${ai.model}). Reply: "${reply.slice(0, 40)}"` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "AI test failed" };
  }
}
