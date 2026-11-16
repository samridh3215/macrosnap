import { config } from "../config.js";
import { getJSON, setJSON, type Cache } from "../storage/cache.js";
import { sha1 } from "../util/hash.js";
import type { Judge, PlausibilityInput, PlausibilityVerdict, SameFoodInput, SameFoodVerdict } from "../judge/judge.js";

const URL_ = "https://openrouter.ai/api/alpha/decisions"; // alpha: the shape may change

type Answers = Record<string, { type: string; choice?: string; probabilities?: Record<string, number> } | undefined>;

/** Jev via OpenRouter's Decisions API. Typed answers with probabilities, never free text. */
export class JevJudge implements Judge {
  readonly kind = "jev";
  constructor(private cache: Cache, private fallback: Judge, private f: typeof fetch = fetch) {}

  private async ask(state: unknown, questions: Record<string, unknown>, apiKey?: string): Promise<Answers> {
    // Hosted mode never falls back to the platform key: the API passes it explicitly when a user may use it.
    const key = apiKey || (config.hosted ? "" : config.openrouterKey);
    if (!key) throw new Error("no OpenRouter key");
    const r = await this.f(URL_, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.judge.model, state, questions }),
      signal: AbortSignal.timeout(config.judge.timeoutMs),
    });
    if (!r.ok) throw new Error(`decisions ${r.status}`);
    return ((await r.json()) as { answers: Answers }).answers;
  }

  async sameFood(i: SameFoodInput, apiKey?: string): Promise<SameFoodVerdict> {
    const ck = `judge:same:${i.query}:${sha1(i.candidates.map((c) => c.key).sort().join("|"))}`;
    const hot = await getJSON<SameFoodVerdict>(this.cache, ck);
    if (hot) return hot;
    try {
      const criteria: Record<string, string> = { none: "None of the candidates is the same dish as the query." };
      for (const c of i.candidates) criteria[c.key] = `${c.name}${c.aliases.length ? ` (also called: ${c.aliases.join(", ")})` : ""}`;
      const a = await this.ask(
        { query: i.query, context: i.context ?? "" },
        { same_dish: { type: "choice", instructions: "Which candidate is the same dish as the query, as it would be served? Different dishes that merely share ingredients are NOT the same.", criteria } },
        apiKey,
      );
      const ans = a.same_dish;
      const choice = ans?.choice;
      if (!choice) return this.fallback.sameFood(i, apiKey);
      const v = { choice, p: ans?.probabilities?.[choice] ?? 0 };
      await setJSON(this.cache, ck, v, 60 * 60 * 24 * 30);
      return v;
    } catch { return this.fallback.sameFood(i, apiKey); }
  }

  async plausibility(i: PlausibilityInput, apiKey?: string): Promise<PlausibilityVerdict> {
    try {
      const a = await this.ask(
        { food: i.name, per100g: i.per100g, unit: i.unit },
        { energy_density: { type: "choice", instructions: "Is the calories-per-100g figure realistic for this food as normally prepared and served?", criteria: {
          too_low: "Calories per 100 g are unrealistically low for this food.",
          ok: "Calories per 100 g are realistic for this food.",
          too_high: "Calories per 100 g are unrealistically high for this food.",
        } } },
        apiKey,
      );
      const ans = a.energy_density;
      const verdict = ans?.choice as PlausibilityVerdict["verdict"] | undefined;
      if (!verdict) return this.fallback.plausibility(i, apiKey);
      return { verdict, p: ans?.probabilities?.[verdict] ?? 0 };
    } catch { return this.fallback.plausibility(i, apiKey); }
  }
}
