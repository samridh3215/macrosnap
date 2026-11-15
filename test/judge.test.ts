import { describe, expect, it } from "vitest";
import { FoodRepo } from "../src/food/repo.js";
import { FakeJudge } from "../src/judge/judge.js";
import { JevJudge } from "../src/llm/decisions.js";
import { MemoryCache } from "../src/storage/cache.js";
import { MemoryStore } from "../src/storage/memory.js";
import { HeuristicJudge } from "../src/judge/judge.js";

const food = (key: string, name: string): any => ({ key, name, aliases: [], hits: 1, per100g: { kcal: 100, protein: 5, carbs: 10, fat: 3, fiber: 1 }, unit: null });

describe("judge in FoodRepo.resolve", () => {
  const setup = async (judge: FakeJudge | null) => {
    const store = new MemoryStore(), repo = new FoodRepo(store, new MemoryCache(), judge);
    await repo.put(food("chole", "Chole")); await repo.put(food("paneer tikka", "Paneer Tikka"));
    return repo;
  };
  it("auto-links same dish with different words", async () => {
    const r = await (await setup(new FakeJudge())).resolve("Chana Masala");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(r.food.key).toBe("chole");
  });
  it("confident 'none' skips the suggestion prompt", async () => {
    const r = await (await setup(new FakeJudge())).resolve("Paneer Tikka Masala");
    expect(r.kind).toBe("miss");
  });
  it("without a judge, behaviour is unchanged (suggests)", async () => {
    const r = await (await setup(null)).resolve("Paneer Tikka Masala");
    expect(r.kind).toBe("suggest");
  });
});

describe("JevJudge", () => {
  it("parses a choice answer and caches it", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify({ answers: { same_dish: { type: "choice", choice: "chole", probabilities: { chole: 0.93, none: 0.07 } } } })); }) as typeof fetch;
    const j = new JevJudge(new MemoryCache(), new HeuristicJudge(), f);
    const i = { query: "chana masala", candidates: [{ key: "chole", name: "Chole", aliases: [] }] };
    expect(await j.sameFood(i, "k")).toEqual({ choice: "chole", p: 0.93 });
    await j.sameFood(i, "k");
    expect(calls).toBe(1);
  });
  it("falls back when the API fails", async () => {
    const j = new JevJudge(new MemoryCache(), new HeuristicJudge(), (async () => new Response("no", { status: 500 })) as typeof fetch);
    expect((await j.sameFood({ query: "x", candidates: [] }, "k")).choice).toBeNull();
  });
});

import { FakeLLM } from "../src/llm/fake.js";
import { NutritionService } from "../src/nutrition/pipeline.js";
import { Settings } from "../src/types.js";

describe("plausibility check", () => {
  it("recomputes once and then flags a food the judge keeps rejecting", async () => {
    const judge = { kind: "stub", sameFood: async () => ({ choice: null, p: 0 }), plausibility: async () => ({ verdict: "too_high" as const, p: 0.95 }) };
    const repo = new FoodRepo(new MemoryStore(), new MemoryCache(), judge), llm = new FakeLLM();
    const a = await new NutritionService(repo, llm).analyze({ note: "dal tadka 200g" }, { settings: Settings.parse({}) });
    expect(llm.calls.filter((c) => c.schemaName === "nutrition")).toHaveLength(2);
    const f = await repo.get("dal tadka");
    expect(f?.validation.ok).toBe(false);
    expect(f?.validation.issues).toContain("judge: implausible energy density");
    expect(a.warnings.join(" ")).toContain("failed checks");
  });
});
