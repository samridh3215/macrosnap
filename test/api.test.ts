import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { FoodRepo } from "../src/food/repo.js";
import { FakeLLM } from "../src/llm/fake.js";
import { NutritionService } from "../src/nutrition/pipeline.js";
import { MemoryCache } from "../src/storage/cache.js";
import { MemoryStore } from "../src/storage/memory.js";
import { addDays, todayIn } from "../src/util/date.js";

let app: ReturnType<typeof buildApp>;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
};

beforeEach(() => {
  const store = new MemoryStore(), cache = new MemoryCache(), llm = new FakeLLM(), repo = new FoodRepo(store, cache);
  app = buildApp({ store, cache, repo, llm, nutrition: new NutritionService(repo, llm), webRoot: "web" });
});

describe("API", () => {
  it("reports which profile fields are still missing", async () => {
    expect((await call("GET", "/api/me")).body.profileMissing).toEqual(["weightKg", "heightCm", "age", "sex"]);
    const r = await call("PUT", "/api/me", { profile: { weightKg: 75, heightCm: 178 } });
    expect(r.body.profileMissing).toEqual(["age", "sex"]);
    await call("PUT", "/api/me", { profile: { weightKg: 75, heightCm: 178, age: 23, sex: "male" } });
    expect((await call("GET", "/api/me")).body.profileMissing).toEqual([]);
  });

  it("full day: profile → analyze → save → dashboard reflects it", async () => {
    const date = todayIn("Asia/Kolkata");
    expect((await call("PUT", "/api/me", { profile: { weightKg: 75, heightCm: 178, age: 23, sex: "male" }, settings: { goal: { type: "cut", ratePctPerWeek: 0.5 } } })).status).toBe(200);

    const a = await call("POST", "/api/analyze", { note: "2 roti, dal tadka 200g, extra ghee" });
    expect(a.status).toBe(200);
    expect(a.body.items).toHaveLength(3);

    const saved = await call("POST", "/api/meals", { date, mealType: "Lunch", name: a.body.mealName, source: "describe", items: a.body.items });
    expect(saved.body.totals.kcal).toBe(a.body.items.reduce((s: number, i: any) => s + i.totals.kcal, 0));

    const d = await call("GET", `/api/day/${date}`);
    expect(d.body.totals.kcal).toBe(saved.body.totals.kcal);
    expect(d.body.targets.bmr.formula).toBe("Mifflin–St Jeor");
    expect(d.body.targets.goalDelta).toBeLessThan(0);
    expect(d.body.presets.map((p: any) => p.id)).toEqual(["idle", "recovery", "easy", "normal", "hard"]);
  });

  it("day presets and manual activities move the targets", async () => {
    const date = "2026-11-10";
    await call("PUT", "/api/me", { profile: { weightKg: 75, heightCm: 178, age: 23, sex: "male" } });
    const idle = await call("PUT", `/api/day/${date}`, { preset: "idle" });
    const hard = await call("PUT", `/api/day/${date}`, { preset: "hard" });
    expect(hard.body.targets.target).toBeGreaterThan(idle.body.targets.target);
    await call("PUT", `/api/day/${date}`, { preset: null });
    const withRun = await call("POST", `/api/day/${date}/activities`, { name: "Tempo", sport: "Run", minutes: 50, distanceKm: 10 });
    expect(withRun.body.activities[0].method).toBe("acsm");
    expect(withRun.body.presetSource).toBe("activities");
    expect(withRun.body.targets.exercise.source).toBe("activities");
  });

  it("rename flow through the API learns corrections", async () => {
    const a = await call("POST", "/api/analyze", { note: "rice cake 80g" });
    const it0 = a.body.items[0];
    const r = await call("POST", "/api/resolve", { name: "idli", grams: 80, lookupKey: it0.lookupKey, previousKey: it0.key });
    expect(r.body.item.name).toBe("Idli");
    expect(r.body.learned.count).toBe(1);
  });

  it("food library: list, edit+verify, rename/merge", async () => {
    await call("POST", "/api/analyze", { note: "roti 40g, rice cake 80g, idli 40g" });
    const list = await call("GET", "/api/foods");
    expect(list.body.length).toBe(3);
    const edited = await call("PUT", "/api/foods/roti", { per100g: { kcal: 280, protein: 9, carbs: 48, fat: 5.5, fiber: 5 } });
    expect(edited.body.food.verified).toBe(true);
    const merged = await call("PUT", `/api/foods/${encodeURIComponent("cake rice")}`, { name: "Idli" });
    expect(merged.body.merged).toBe(true);
    expect((await call("GET", "/api/foods")).body.length).toBe(2);
    const blocked = await call("POST", "/api/foods/roti/recompute", {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/verified/);
  });

  it("recompute accepts an edited recipe and validates it", async () => {
    await call("POST", "/api/analyze", { note: "idli 40g" });
    const ok = await call("POST", "/api/foods/idli/recompute", { recipe: [{ name: "rice batter", grams: 60 }, { name: "ghee", grams: 3 }], note: "extra ghee" });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
    const bad = await call("POST", "/api/foods/idli/recompute", { recipe: [{ name: "", grams: -5 }] });
    expect(bad.status).toBe(400);
  });

  it("adaptive TDEE kicks in after enough logged days + weigh-ins", async () => {
    await call("PUT", "/api/me", { profile: { weightKg: 76, heightCm: 178, age: 23, sex: "male" } });
    const today = todayIn("Asia/Kolkata");
    const roti = (await call("POST", "/api/analyze", { note: "roti 1000g" })).body.items[0]; // ≈ 2640 kcal
    for (let i = 1; i <= 28; i++) {
      const date = addDays(today, -i);
      await call("POST", "/api/meals", { date, mealType: "Lunch", name: "x", source: "manual", items: [roti] });
      if (i % 2 === 0) await call("PUT", `/api/weights/${date}`, { kg: 76 + (28 - i) * 0.03 }); // gaining slowly
    }
    const d = await call("GET", `/api/day/${today}`);
    expect(d.body.adaptive.ready).toBe(true);
    expect(d.body.adaptive.observedTdee).toBeGreaterThan(2300);
    const t = await call("GET", "/api/trends?days=28");
    expect(t.body.series).toHaveLength(28);
    expect(t.body.series.some((s: any) => s.trend != null)).toBe(true);
  });

  it("validates input", async () => {
    expect((await call("POST", "/api/analyze", {})).status).toBe(400);
    expect((await call("POST", "/api/meals", { date: "bad" })).status).toBe(400);
  });
});
