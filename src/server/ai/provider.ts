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

export class AIUnavailableError extends Error {
  /** Per-attempt diagnostics (model, status, duration) for the Super Admin test. */
  attempts: string[] = [];
}

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

  private async call(model: string, body: unknown, ms: number) {
    return fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  }

  private async candidates(): Promise<{ models: string[]; note: string }> {
    try {
      const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": this.apiKey }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { models: [], note: `model list: ${await GeminiProvider.describe(res)}` };
      const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      const models = rankGeminiModels(data.models ?? []);
      return { models, note: `model list: ${models.length} flash model(s) available` };
    } catch (e) {
      return { models: [], note: `model list: ${e instanceof Error ? e.message : "failed"}` };
    }
  }

  private static async describe(res: Response) {
    const err = (await res.json().catch(() => ({}))) as GeminiResponse;
    return `${res.status} ${err.error?.status ?? ""} ${err.error?.message ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 300);
  }

  /** Gemini 2.5 Flash models "think" by default; short help answers don't need it and it is much slower. */
  private static config(model: string, maxTokens: number) {
    const cfg: Record<string, unknown> = { maxOutputTokens: Math.max(maxTokens, 1024), temperature: 0.3 };
    if (/2\.5-flash/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
    return cfg;
  }

  async complete({ system, messages, maxTokens = 2000 }: Parameters<AIProvider["complete"]>[0]) {
    const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    // Preferred model first (one retry on a temporary error), then other available
    // flash models — free-tier models are sometimes briefly overloaded or slow.
    const started = Date.now();
    const budgetMs = 40_000;
    const attempts: string[] = [];
    const tried = new Set<string>();
    let order = [this.model];
    let fetchedList = false;
    let rateLimited = false;
    for (let i = 0; i < order.length && tried.size < 4; i++) {
      const model = order[i]!;
      if (tried.has(model)) continue;
      tried.add(model);
      for (let attempt = 0; attempt < 2; attempt++) {
        const remaining = budgetMs - (Date.now() - started);
        if (remaining < 3_000) break;
        const t0 = Date.now();
        let status = 0;
        try {
          const res = await this.call(model, { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: GeminiProvider.config(model, maxTokens) }, Math.min(20_000, remaining));
          status = res.status;
          if (res.ok) {
            if (model !== this.configuredModel) discoveredGeminiModel = model;
            return geminiText((await res.json()) as GeminiResponse);
          }
          const why = await GeminiProvider.describe(res);
          attempts.push(`${model}: ${why} (${Date.now() - t0} ms)`);
          console.error(`Gemini ${model} failed: ${why}`);
          if (status === 400 || status === 401 || status === 403) {
            const err = new AIUnavailableError(status === 400 ? "The AI request was rejected." : "AI provider credentials are invalid.");
            err.attempts = attempts;
            throw err;
          }
          if (status === 429) rateLimited = true;
        } catch (e) {
          if (e instanceof AIUnavailableError) throw e;
          // Network error or timeout: treat as temporary and move on.
          attempts.push(`${model}: ${e instanceof Error ? e.message : "network error"} (${Date.now() - t0} ms)`);
          console.error(`Gemini ${model} error:`, e);
        }
        if (status === 404 || attempt === 1) break;
        await new Promise((r) => setTimeout(r, status === 429 ? 1500 : 700));
      }
      if (!fetchedList) {
        fetchedList = true;
        const { models, note } = await this.candidates();
        attempts.push(note);
        order = [...order, ...models.filter((m) => !tried.has(m))];
      }
    }
    const err = new AIUnavailableError(rateLimited
      ? "The AI service is busy (free-tier limit reached). Please try again shortly."
      : "The AI service is temporarily unavailable. Please try again shortly.");
    err.attempts = attempts;
    throw err;
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
    const detail = e instanceof AIUnavailableError && e.attempts.length ? ` Details: ${e.attempts.join(" | ")}` : "";
    return { ok: false, message: `${e instanceof Error ? e.message : "AI test failed"}${detail}` };
  }
}
