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
  return rankGeminiModels(models)[0] ?? null;
}

/** All usable text "flash" models, best first (stable before preview, newest, full before lite). */
export function rankGeminiModels(models: { name: string; supportedGenerationMethods?: string[] }[]): string[] {
  const ok = models.filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /flash/.test(n) && !/(image|tts|audio|live|embedding|vision|exp|thinking)/.test(n));
  const stable = ok.filter((n) => !/preview/.test(n));
  const pool = stable.length ? stable : ok;
  // Prefer the newest version number, then the full (non-lite) model.
  const ver = (n: string) => Number(n.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  pool.sort((x, y) => ver(y) - ver(x) || Number(/lite/.test(x)) - Number(/lite/.test(y)) || x.length - y.length);
  const rest = ok.filter((n) => !pool.includes(n));
  return [...pool, ...rest];
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

  private async candidates(): Promise<string[]> {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": this.apiKey }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return rankGeminiModels(data.models ?? []);
  }

  private static async describe(res: Response) {
    const err = (await res.json().catch(() => ({}))) as GeminiResponse;
    return `${res.status} ${err.error?.status ?? ""} ${err.error?.message ?? ""}`.trim();
  }

  async complete({ system, messages, maxTokens = 2000 }: Parameters<AIProvider["complete"]>[0]) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: Math.max(maxTokens, 1024), temperature: 0.3 },
    };
    // Try the preferred model (with one retry on a temporary error), then other
    // available flash models: free-tier models are sometimes briefly overloaded.
    const tried = new Set<string>();
    let order = [this.model];
    let lastError = "";
    let fetchedList = false;
    for (let i = 0; i < order.length && tried.size < 4; i++) {
      const model = order[i]!;
      if (tried.has(model)) continue;
      tried.add(model);
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await this.call(model, body);
        if (res.ok) {
          if (model !== this.configuredModel) discoveredGeminiModel = model;
          return geminiText((await res.json()) as GeminiResponse);
        }
        lastError = await GeminiProvider.describe(res);
        console.error(`Gemini ${model} failed: ${lastError}`);
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw new AIUnavailableError(res.status === 400 ? "The AI request was rejected." : "AI provider credentials are invalid.");
        }
        // 404 (model retired) → move on; 429/5xx → short back-off, then retry once / move on.
        if (res.status === 404 || attempt === 1) break;
        await new Promise((r) => setTimeout(r, res.status === 429 ? 1500 : 800));
      }
      if (!fetchedList) {
        fetchedList = true;
        order = [...order, ...(await this.candidates()).filter((m) => !tried.has(m))];
      }
    }
    throw new AIUnavailableError(/429/.test(lastError)
      ? "The AI service is busy (free-tier limit reached). Please try again shortly."
      : "The AI service is temporarily unavailable. Please try again shortly.");
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
