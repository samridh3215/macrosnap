import { foodKey } from "../food/key.js";
import { IdentifyOut, NutritionOut } from "../nutrition/schemas.js";
import type { JsonRequest, JsonResult, LLM, ModelInfo } from "./types.js";

/**
 * Deterministic stand-in for OpenRouter (FAKE_LLM=1). Lets the whole app — UI, cache, Capella,
 * learning loop — be developed and tested without spending a rupee.
 * Describe mode understands simple text like "2 roti, dal tadka 200g, extra ghee".
 */
const TABLE: Record<string, { kcal: number; p: number; c: number; f: number; fib: number; unit?: [string, number]; cat: string }> = {
  "dal tadka": { kcal: 120, p: 6.2, c: 14.5, f: 3.6, fib: 3.4, cat: "dal/legume" },
  roti: { kcal: 264, p: 8.4, c: 46, f: 4.6, fib: 6.5, unit: ["roti", 40], cat: "bread" },
  rice: { kcal: 130, p: 2.7, c: 28.2, f: 0.3, fib: 0.4, cat: "rice" },
  "chicken tandoori": { kcal: 165, p: 25, c: 3, f: 6, fib: 0.3, unit: ["piece", 90], cat: "meat" },
  ghee: { kcal: 896, p: 0, c: 0, f: 99.6, fib: 0, cat: "fat/oil" },
  "paneer tikka": { kcal: 230, p: 14, c: 6, f: 16.5, fib: 0.8, cat: "snack" },
  idli: { kcal: 132, p: 4.2, c: 27, f: 0.5, fib: 1.1, unit: ["idli", 40], cat: "breakfast" },
  sambar: { kcal: 70, p: 3.2, c: 9.5, f: 2, fib: 2.3, cat: "dal/legume" },
};

export class FakeLLM implements LLM {
  readonly kind = "fake";
  calls: Array<{ schemaName: string; model: string }> = [];

  async listModels(): Promise<ModelInfo[]> {
    const m = (id: string, img: boolean, created: number): ModelInfo => ({
      id, name: id, created, contextLength: 200000, inputModalities: img ? ["text", "image"] : ["text"],
      promptPrice: 1e-6, completionPrice: 5e-6, supported: ["structured_outputs", "response_format", "reasoning"],
    });
    return [m("anthropic/claude-haiku-5.5", true, 2), m("anthropic/claude-sonnet-5.5", true, 2), m("openai/gpt-6-mini", true, 1)];
  }

  async json<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    this.calls.push({ schemaName: req.schemaName, model: req.model });
    const text = req.user.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    let data: unknown;
    if (req.schemaName === "identify") data = this.identify(text, req.user.some((p) => p.type === "image_url"));
    else data = this.nutrition(text);
    return { data: req.schema.parse(data), model: req.model, usage: { promptTokens: 1000, completionTokens: 200, costUsd: 0.0004 }, attempts: 1 };
  }

  private identify(text: string, hasImage: boolean): IdentifyOut {
    const note = /(?:note|description):\s*([\s\S]*)$/i.exec(text)?.[1]?.trim() ?? "";
    const parts = note ? note.split(/,|\band\b|\+/).map((s) => s.trim()).filter(Boolean) : hasImage ? ["dal tadka 180g", "2 roti", "rice 150g"] : [];
    const items = parts.map((p) => {
      const addon = /extra|on top|added/i.test(p);
      const count = Number(/^(\d+)\s/.exec(p)?.[1] ?? 0) || null;
      const grams = Number(/(\d+)\s*g\b/.exec(p)?.[1] ?? 0);
      const name = p.replace(/^\d+\s*/, "").replace(/\d+\s*g\b/, "").replace(/extra|on top|added/gi, "").trim();
      const row = TABLE[foodKey(name)];
      const g = grams || (addon ? 10 : count && row?.unit ? count * row.unit[1] : 150);
      return { seen_name: name, canonical_name: name, portion: count ? `${count} pieces` : `${g} g`, grams: g, count, is_addon: addon, confidence: "medium" as const, label: null };
    });
    return { meal_name: items.map((i) => i.canonical_name).slice(0, 3).join(", ") || "Nothing found", items, notes: items.length ? "fake model" : "no food" };
  }

  private nutrition(text: string): NutritionOut {
    const lines = [...text.matchAll(/id=(\S+): "([^"]+)"/g)];
    return {
      foods: lines.map(([, id, name]) => {
        const row = TABLE[foodKey(name)] ?? { kcal: 150, p: 5, c: 20, f: 5.4, fib: 2, cat: "unknown" };
        return {
          id, canonical_name: name, category: row.cat,
          per100g: { kcal: row.kcal, protein: row.p, carbs: row.c, fat: row.f, fiber: row.fib },
          unit: row.unit ? { name: row.unit[0], grams: row.unit[1] } : null,
          ingredients: [{ name: `${name} (aggregate)`, grams: 100, kcal: row.kcal }],
          assumptions: "fake model: typical home recipe", references: ["fake table"], confidence: "medium" as const,
        };
      }),
    };
  }
}
