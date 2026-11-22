import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";

/**
 * Provider-agnostic AI interface used by LEX and service-update summaries.
 * Configure with AI_PROVIDER / AI_API_KEY / AI_MODEL (server-side only).
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

export function getAIProvider(): AIProvider | null {
  const env = serverEnv();
  if (!env.aiApiKey) return null;
  switch (env.aiProvider) {
    case "anthropic":
      return new AnthropicProvider(env.aiApiKey, env.aiModel || "claude-opus-5-5");
    default:
      return null;
  }
}
