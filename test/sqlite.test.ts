import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { FoodRepo } from "../src/food/repo.js";
import { FakeLLM } from "../src/llm/fake.js";
import { NutritionService } from "../src/nutrition/pipeline.js";
import { MemoryCache } from "../src/storage/cache.js";
import { SqliteStore } from "../src/storage/sqlite.js";
import { todayIn } from "../src/util/date.js";

describe("SqliteStore", () => {
  it("round-trips docs, ranges, corrections and deletes", async () => {
    const s = new SqliteStore(":memory:"); await s.init();
    const food: any = { key: "dal", name: "Dal", aliases: ["daal"], hits: 2 };
    await s.putFood(food);
    expect(await s.getFood("dal")).toEqual(food);
    expect((await s.listFoods({ q: "daal" })).map((f) => f.key)).toEqual(["dal"]);
    expect(await s.bumpCorrection("a", "b")).toBe(1);
    expect(await s.bumpCorrection("a", "b")).toBe(2);
    await s.putMeal({ id: "1", uid: "u", date: "2026-01-02", ts: 2 } as any);
    await s.putMeal({ id: "2", uid: "u", date: "2026-01-01", ts: 1 } as any);
    await s.putMeal({ id: "3", uid: "other", date: "2026-01-01", ts: 1 } as any);
    expect((await s.listMeals("u", "2026-01-01", "2026-01-02")).map((m) => m.id)).toEqual(["2", "1"]);
    await s.deleteMeal("u", "1");
    expect(await s.getMeal("u", "1")).toBeNull();
    await s.close();
  });

  it("full day works end to end on SQLite", async () => {
    const store = new SqliteStore(":memory:"); await store.init();
    const cache = new MemoryCache(), llm = new FakeLLM(), repo = new FoodRepo(store, cache);
    const app = buildApp({ store, cache, repo, llm, nutrition: new NutritionService(repo, llm), webRoot: "web" });
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return (await r.json()) as any;
    };
    const date = todayIn("Asia/Kolkata");
    const a = await call("POST", "/api/analyze", { note: "2 roti, dal tadka 200g" });
    const saved = await call("POST", "/api/meals", { date, mealType: "Lunch", name: a.mealName, source: "describe", items: a.items });
    expect((await call("GET", `/api/day/${date}`)).totals.kcal).toBe(saved.totals.kcal);
    expect((await call("GET", "/api/foods")).length ?? (await call("GET", "/api/foods")).foods?.length).toBeGreaterThan(0);
  });
});
