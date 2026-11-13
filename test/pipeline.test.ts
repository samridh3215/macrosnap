import { beforeEach, describe, expect, it } from "vitest";
import { FoodRepo } from "../src/food/repo.js";
import { FakeLLM } from "../src/llm/fake.js";
import type { JsonRequest, JsonResult, LLM } from "../src/llm/types.js";
import { NutritionService } from "../src/nutrition/pipeline.js";
import { validateNutrition } from "../src/nutrition/validate.js";
import { MemoryCache } from "../src/storage/cache.js";
import { MemoryStore } from "../src/storage/memory.js";
import { Settings } from "../src/types.js";

const ctx = { settings: Settings.parse({}) };

describe("nutrition pipeline", () => {
  let store: MemoryStore, cache: MemoryCache, repo: FoodRepo, llm: FakeLLM, svc: NutritionService;
  beforeEach(() => {
    store = new MemoryStore(); cache = new MemoryCache(); repo = new FoodRepo(store, cache);
    llm = new FakeLLM(); svc = new NutritionService(repo, llm);
  });

  it("computes new foods once, then serves them from cache", async () => {
    const a = await svc.analyze({ note: "2 roti, dal tadka 200g" }, ctx);
    expect(a.items.map((i) => i.match.type)).toEqual(["new", "new"]);
    expect(a.items[0].grams).toBe(80); // 2 × 40 g roti unit
    expect(a.items[0].totals.kcal).toBe(211);
    expect(llm.calls.filter((c) => c.schemaName === "nutrition")).toHaveLength(1); // batched

    const b = await svc.analyze({ note: "3 chapatis, daal tadka 150g" }, ctx);
    expect(b.items.map((i) => i.match.type)).toEqual(["exact", "exact"]); // synonyms → same keys
    expect(b.items[0].grams).toBe(120);
    expect(llm.calls.filter((c) => c.schemaName === "nutrition")).toHaveLength(1); // no new reasoning call
    expect(b.stats.cacheHits).toBe(2);
  });

  it("serves from Capella when Redis is cold", async () => {
    await svc.analyze({ note: "ghee 10g" }, ctx);
    const cold = new NutritionService(new FoodRepo(store, new MemoryCache()), llm);
    const r = await cold.analyze({ note: "ghee 5g" }, ctx);
    expect(r.items[0].match.type).toBe("exact");
  });

  it("turns note extras into add-on items", async () => {
    const r = await svc.analyze({ note: "dal tadka 200g, extra ghee" }, ctx);
    const ghee = r.items.find((i) => i.key === "ghee")!;
    expect(ghee.isAddon).toBe(true);
    expect(ghee.totals.fat).toBeGreaterThan(9);
  });

  it("auto-links spelling slips and suggests related dishes", async () => {
    await svc.analyze({ note: "paneer tikka 150g" }, ctx);
    const slip = await svc.analyze({ note: "panir tika 100g" }, ctx); // synonyms → exact
    expect(slip.items[0].match.type).toBe("exact");
    const related = await svc.analyze({ note: "paneer tikka masala 200g" }, ctx);
    expect(related.items[0].match).toMatchObject({ type: "fuzzy", auto: false, candidateName: "Paneer Tikka" });
  });

  it("learns from repeated renames and promotes them to aliases", async () => {
    // Vision keeps calling idli "rice cake"; user corrects it twice.
    const first = await svc.analyze({ note: "rice cake 80g" }, ctx);
    const item = first.items[0];
    const r1 = await svc.resolveItem({ name: "idli", grams: item.grams, lookupKey: item.lookupKey, previousKey: item.key }, ctx);
    expect(r1.item.key).toBe("idli");
    expect(r1.learned).toEqual({ promoted: false, count: 1 });
    const r2 = await svc.resolveItem({ name: "idli", grams: 80, lookupKey: item.lookupKey, previousKey: item.key }, ctx);
    expect(r2.learned).toEqual({ promoted: true, count: 2 });
    const third = await svc.analyze({ note: "rice cake 120g" }, ctx);
    expect(third.items[0]).toMatchObject({ key: "idli", match: { type: "alias" } });
  });

  it("'not the same' rejects a fuzzy link and computes a new food", async () => {
    await svc.analyze({ note: "paneer tikka 150g" }, ctx);
    const r = await svc.resolveItem({ name: "paneer tikka masala", grams: 200, rejectKey: "paneer tikka" }, ctx);
    expect(r.item.key).toBe("masala paneer tikka");
    expect(r.item.match.type).toBe("new");
    const again = await svc.analyze({ note: "paneer tikka masala 100g" }, ctx);
    expect(again.items[0].match.type).toBe("exact");
  });

  it("renaming a library food re-keys and keeps the old name resolving", async () => {
    await svc.analyze({ note: "rice cake 80g" }, ctx);
    const { food, merged } = await repo.rename("cake rice", "Idli");
    expect(food.key).toBe("idli");
    expect(merged).toBe(false);
    const r = await repo.resolve("rice cake");
    expect(r.kind === "hit" && r.food.key).toBe("idli");
  });
});

describe("validation + self-repair", () => {
  it("flags made-up numbers", () => {
    expect(validateNutrition({ kcal: 500, protein: 10, carbs: 10, fat: 5, fiber: 0 }).ok).toBe(false);
    expect(validateNutrition({ kcal: 120, protein: 6.2, carbs: 14.5, fat: 3.6, fiber: 3.4 }).ok).toBe(true);
    expect(validateNutrition({ kcal: 900, protein: 50, carbs: 50, fat: 60, fiber: 0 }).issues.join()).toMatch(/impossible/);
  });

  it("re-asks the reasoning model when its numbers don't add up", async () => {
    let n = 0;
    const bad = { kcal: 400, protein: 6, carbs: 14, fat: 3.6, fiber: 3 };
    const good = { kcal: 120, protein: 6.2, carbs: 14.5, fat: 3.6, fiber: 3.4 };
    const llm: LLM = {
      kind: "test",
      listModels: async () => [],
      async json<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
        if (req.schemaName === "identify") {
          return { data: req.schema.parse({ meal_name: "dal", items: [{ seen_name: "dal", canonical_name: "dal tadka", portion: "1 katori", grams: 150, count: null, is_addon: false, confidence: "high" }], notes: "" }), model: "v", usage: null, attempts: 1 };
        }
        n++;
        const per100g = n === 1 ? bad : good;
        return { data: req.schema.parse({ foods: [{ id: "f1", canonical_name: "Dal Tadka", category: "dal", per100g, unit: null, ingredients: [], assumptions: "", references: ["IFCT 2017"], confidence: "high" }] }), model: "r", usage: null, attempts: 1 };
      },
    };
    const svc = new NutritionService(new FoodRepo(new MemoryStore(), new MemoryCache()), llm);
    const r = await svc.analyze({ image: "AAAA" }, ctx);
    expect(n).toBe(2);
    expect(r.items[0].per100g).toEqual(good);
    expect(r.warnings).toEqual([]);
  });
});
