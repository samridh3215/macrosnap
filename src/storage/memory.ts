import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Alias, Correction, Day, Food, Meal, User, Weight } from "../types.js";
import { ids, now, type Store } from "./store.js";

type Tables = {
  foods: Record<string, Food>;
  aliases: Record<string, Alias>;
  corrections: Record<string, Correction>;
  users: Record<string, User>;
  meals: Record<string, Meal>;
  weights: Record<string, Weight>;
  days: Record<string, Day>;
};

const clone = <T>(v: T): T => (v == null ? v : structuredClone(v));
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

/** Dev/test store. Persists to a JSON file when a path is given (debounced). */
export class MemoryStore implements Store {
  readonly kind = "memory";
  private t: Tables = { foods: {}, aliases: {}, corrections: {}, users: {}, meals: {}, weights: {}, days: {} };
  private timer: NodeJS.Timeout | null = null;
  constructor(private file: string | null = null) {}

  async init() {
    if (!this.file) return;
    try { this.t = { ...this.t, ...JSON.parse(await readFile(this.file, "utf8")) }; } catch { /* first run */ }
  }
  async close() { if (this.timer) { clearTimeout(this.timer); await this.flush(); } }
  private touch() {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }
  private async flush() {
    this.timer = null;
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.t));
  }

  async getFood(key: string) { return clone(this.t.foods[ids.food(key)] ?? null); }
  async putFood(f: Food) { this.t.foods[ids.food(f.key)] = clone(f); this.touch(); }
  async deleteFood(key: string) { delete this.t.foods[ids.food(key)]; this.touch(); }
  async listFoods({ q, limit = 200 }: { q?: string; limit?: number }) {
    const needle = (q || "").toLowerCase();
    return Object.values(this.t.foods)
      .filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.key.includes(needle) || f.aliases.some((a) => a.toLowerCase().includes(needle)))
      .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name))
      .slice(0, limit).map(clone);
  }
  async listFoodIndex() { return Object.values(this.t.foods).map((f) => ({ key: f.key, name: f.name })); }

  async getAlias(alias: string) { return clone(this.t.aliases[ids.alias(alias)] ?? null); }
  async putAlias(a: Alias) { this.t.aliases[ids.alias(a.alias)] = clone(a); this.touch(); }
  async aliasesTo(target: string) { return Object.values(this.t.aliases).filter((a) => a.target === target).map(clone); }

  async bumpCorrection(from: string, to: string) {
    const id = ids.correction(from, to);
    const c = this.t.corrections[id] ?? { from, to, count: 0, updatedAt: now() };
    c.count += 1; c.updatedAt = now();
    this.t.corrections[id] = c; this.touch();
    return c.count;
  }

  async getUser(uid: string) { return clone(this.t.users[ids.user(uid)] ?? null); }
  async putUser(u: User) { this.t.users[ids.user(u.uid)] = clone(u); this.touch(); }

  async getMeal(uid: string, id: string) { return clone(this.t.meals[ids.meal(uid, id)] ?? null); }
  async putMeal(m: Meal) { this.t.meals[ids.meal(m.uid, m.id)] = clone(m); this.touch(); }
  async deleteMeal(uid: string, id: string) { delete this.t.meals[ids.meal(uid, id)]; this.touch(); }
  async listMeals(uid: string, from: string, to: string) {
    return Object.values(this.t.meals).filter((m) => m.uid === uid && inRange(m.date, from, to)).sort((a, b) => a.ts - b.ts).map(clone);
  }

  async putWeight(w: Weight) { this.t.weights[ids.weight(w.uid, w.date)] = clone(w); this.touch(); }
  async deleteWeight(uid: string, date: string) { delete this.t.weights[ids.weight(uid, date)]; this.touch(); }
  async listWeights(uid: string, from: string, to: string) {
    return Object.values(this.t.weights).filter((w) => w.uid === uid && inRange(w.date, from, to)).sort((a, b) => a.date.localeCompare(b.date)).map(clone);
  }

  async getDay(uid: string, date: string) { return clone(this.t.days[ids.day(uid, date)] ?? null); }
  async putDay(d: Day) { this.t.days[ids.day(d.uid, d.date)] = clone(d); this.touch(); }
  async listDays(uid: string, from: string, to: string) {
    return Object.values(this.t.days).filter((d) => d.uid === uid && inRange(d.date, from, to)).sort((a, b) => a.date.localeCompare(b.date)).map(clone);
  }
}
