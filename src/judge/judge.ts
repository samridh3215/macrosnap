import type { Macros } from "../types.js";

export interface SameFoodInput {
  query: string;
  context?: string;
  candidates: Array<{ key: string; name: string; aliases: string[] }>;
}
/** choice is a candidate key, "none", or null when the judge has no opinion. */
export interface SameFoodVerdict { choice: string | null; p: number }

export interface PlausibilityInput { name: string; per100g: Macros; unit: { name: string; grams: number } | null }
export interface PlausibilityVerdict { verdict: "too_low" | "ok" | "too_high"; p: number }

/** Settles uncertain food matches and sanity-checks computed numbers. It decides; it never computes nutrition. */
export interface Judge {
  readonly kind: string;
  sameFood(i: SameFoodInput, apiKey?: string): Promise<SameFoodVerdict>;
  plausibility(i: PlausibilityInput, apiKey?: string): Promise<PlausibilityVerdict>;
}

/** No opinion: the app falls back to its deterministic similarity rules. */
export class HeuristicJudge implements Judge {
  readonly kind = "heuristic";
  async sameFood(): Promise<SameFoodVerdict> { return { choice: null, p: 0 }; }
  async plausibility(): Promise<PlausibilityVerdict> { return { verdict: "ok", p: 0 }; }
}

/** Deterministic judge for tests and dev:fake. */
export class FakeJudge implements Judge {
  readonly kind = "fake";
  private same: Array<[string, string]> = [["chana masala", "chole"], ["chole", "chana masala"]];
  async sameFood(i: SameFoodInput): Promise<SameFoodVerdict> {
    const q = i.query.toLowerCase();
    for (const c of i.candidates) {
      const names = [c.name, ...c.aliases].map((n) => n.toLowerCase());
      if (this.same.some(([a, b]) => q.includes(a) && names.some((n) => n.includes(b)))) return { choice: c.key, p: 0.95 };
    }
    return i.candidates.length ? { choice: "none", p: 0.9 } : { choice: null, p: 0 };
  }
  async plausibility(i: PlausibilityInput): Promise<PlausibilityVerdict> {
    if (/\bdal\b/i.test(i.name) && i.per100g.kcal > 200) return { verdict: "too_high", p: 0.9 };
    return { verdict: "ok", p: 0.9 };
  }
}
