import type { Settings } from "../types.js";
import type { LLM, ModelInfo } from "./types.js";

/**
 * "Auto" model selection, resolved live against OpenRouter's catalogue so it never goes stale:
 * walk a preference list of model families and take the newest release in the first family present.
 */
const VISION_PREFS: RegExp[] = [
  /^anthropic\/claude-haiku/,
  /^openai\/gpt-[\d.]+-mini$/,
  /^openai\/gpt-[\d.]+o?-mini/,
  /^qwen\/qwen[\d.]*-vl/,
  /^google\/gemini-[\d.]+-flash(?!-lite)/,
];
const REASONING_PREFS: RegExp[] = [
  /^anthropic\/claude-sonnet/,
  /^openai\/gpt-[\d.]+$/,
  /^deepseek\/deepseek-r/,
  /^qwen\/qwen[\d.]*-(max|plus|235b)/,
  /^google\/gemini-[\d.]+-pro/,
];
// Last-resort ids if the catalogue can't be fetched.
const FALLBACK = { vision: "anthropic/claude-haiku-5.5", reasoning: "anthropic/claude-sonnet-5.5" };

const usable = (m: ModelInfo) => !m.id.includes(":free") && !/preview|beta|exp/i.test(m.id);

export function pickModel(models: ModelInfo[], prefs: RegExp[], needImage: boolean): string | null {
  const pool = models.filter((m) => usable(m) && (!needImage || m.inputModalities.includes("image")));
  for (const re of prefs) {
    const hits = pool.filter((m) => re.test(m.id)).sort((a, b) => b.created - a.created);
    if (hits.length) return hits[0].id;
  }
  // Nothing from the preference list: cheapest capable model with structured outputs.
  const generic = pool.filter((m) => m.supported.includes("structured_outputs")).sort((a, b) => a.promptPrice - b.promptPrice);
  return generic[0]?.id ?? null;
}

export interface ResolvedModels { mode: "auto" | "manual"; vision: string; reasoning: string; note?: string }

export async function resolveModels(llm: LLM, settings: Settings, apiKey?: string): Promise<ResolvedModels> {
  const m = settings.models;
  if (m.mode === "manual" && m.vision && m.reasoning) return { mode: "manual", vision: m.vision, reasoning: m.reasoning };
  try {
    const models = await llm.listModels(apiKey);
    return {
      mode: "auto",
      vision: (m.mode === "manual" && m.vision) || pickModel(models, VISION_PREFS, true) || FALLBACK.vision,
      reasoning: (m.mode === "manual" && m.reasoning) || pickModel(models, REASONING_PREFS, false) || FALLBACK.reasoning,
    };
  } catch {
    return { mode: "auto", ...FALLBACK, note: "model catalogue unavailable; using fallbacks" };
  }
}
