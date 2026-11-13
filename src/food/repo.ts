import { config } from "../config.js";
import { getJSON, setJSON, type Cache } from "../storage/cache.js";
import { now, type Store } from "../storage/store.js";
import type { Alias, Food, MatchInfo } from "../types.js";
import { bestMatch, foodKey } from "./key.js";

const CK = {
  food: (k: string) => `food:${k}`,
  alias: (k: string) => `alias:${k}`,
  index: "foods:index", // hash key -> display name, for fuzzy matching
  indexReady: "foods:index:ready",
};
const NO_ALIAS = "__none__";

export type Resolution =
  | { kind: "hit"; food: Food; match: MatchInfo; lookupKey: string }
  | { kind: "suggest"; food: Food; match: MatchInfo; lookupKey: string } // provisional, user should confirm
  | { kind: "miss"; lookupKey: string; name: string };

/**
 * Read-through food library: Redis (hot) → Capella (durable) → caller computes with the LLM.
 * Also owns aliases (fuzzy/correction/rename links), the correction-learning loop and re-keying.
 */
export class FoodRepo {
  constructor(private store: Store, private cache: Cache) {}

  async get(key: string): Promise<Food | null> {
    if (!key) return null;
    const hot = await getJSON<Food>(this.cache, CK.food(key));
    if (hot) return hot;
    const f = await this.store.getFood(key);
    if (f) await setJSON(this.cache, CK.food(key), f, config.food.cacheTtlSec);
    return f;
  }

  async put(f: Food) {
    await this.store.putFood(f); // durable first
    await setJSON(this.cache, CK.food(f.key), f, config.food.cacheTtlSec);
    await this.cache.hset(CK.index, f.key, f.name);
  }

  async remove(key: string) {
    await this.store.deleteFood(key);
    await this.cache.del(CK.food(key));
    await this.cache.hdel(CK.index, key);
  }

  async index(): Promise<Array<{ key: string; name: string }>> {
    if (!(await this.cache.exists(CK.indexReady))) {
      const all = await this.store.listFoodIndex();
      for (const e of all) await this.cache.hset(CK.index, e.key, e.name);
      await this.cache.set(CK.indexReady, "1", 3600); // rebuild hourly as a safety net
      return all;
    }
    return Object.entries(await this.cache.hgetall(CK.index)).map(([key, name]) => ({ key, name }));
  }

  async getAlias(key: string): Promise<Alias | null> {
    const hot = await this.cache.get(CK.alias(key));
    if (hot === NO_ALIAS) return null;
    if (hot) return JSON.parse(hot) as Alias;
    const a = await this.store.getAlias(key);
    await this.cache.set(CK.alias(key), a ? JSON.stringify(a) : NO_ALIAS, 3600);
    return a;
  }

  async putAlias(a: Alias) {
    await this.store.putAlias(a);
    await this.cache.set(CK.alias(a.alias), JSON.stringify(a), 3600);
  }

  async recordHit(f: Food) {
    // Best-effort popularity counter (drives library ordering). Not worth a CAS loop.
    f.hits += 1;
    await this.put(f);
  }

  /**
   * Resolve a display name to a library food.
   * @param opts.fuzzy  "full" = auto-link ≥ fuzzyAuto and suggest ≥ fuzzySuggest; "strict" = only auto-link (user-typed names)
   * @param opts.rejectKeys  candidates the user already said "not the same" to
   */
  async resolve(name: string, opts: { fuzzy?: "full" | "strict" | "off"; rejectKeys?: string[] } = {}): Promise<Resolution> {
    const lookupKey = foodKey(name);
    const fuzzy = opts.fuzzy ?? "full";
    if (!lookupKey) return { kind: "miss", lookupKey, name };

    const alias = await this.getAlias(lookupKey);
    // A correction learned from the user ("it's idli, not rice cake") outranks even an exact match,
    // because the exact entry is usually the vision model's mistake that got computed once.
    if (alias && !alias.rejected && alias.origin === "correction") {
      const target = await this.get(alias.target);
      if (target) return { kind: "hit", food: target, match: { type: "alias", candidateName: target.name }, lookupKey };
    }

    const exact = await this.get(lookupKey);
    if (exact) return { kind: "hit", food: exact, match: { type: "exact" }, lookupKey };

    if (alias && !alias.rejected) {
      const target = await this.get(alias.target);
      if (target) return { kind: "hit", food: target, match: { type: "alias", candidateName: target.name }, lookupKey };
    }

    if (fuzzy !== "off") {
      const exclude = new Set(opts.rejectKeys ?? []);
      if (alias?.rejected) exclude.add(alias.target);
      const best = bestMatch(lookupKey, await this.index(), exclude);
      if (best && best.score >= config.food.fuzzyAuto) {
        const food = await this.get(best.key);
        if (food) {
          await this.putAlias({ alias: lookupKey, target: food.key, origin: "fuzzy", rejected: false, updatedAt: now() });
          return { kind: "hit", food, match: { type: "fuzzy", auto: true, score: round2(best.score), candidateName: food.name }, lookupKey };
        }
      }
      if (fuzzy === "full" && best && best.score >= config.food.fuzzySuggest) {
        const food = await this.get(best.key);
        if (food) return { kind: "suggest", food, match: { type: "fuzzy", auto: false, score: round2(best.score), candidateName: food.name }, lookupKey };
      }
    }
    return { kind: "miss", lookupKey, name };
  }

  /** User confirmed a fuzzy suggestion ("yes, same thing"). */
  async confirmLink(fromKey: string, toKey: string) {
    if (!fromKey || fromKey === toKey) return;
    await this.putAlias({ alias: fromKey, target: toKey, origin: "manual", rejected: false, updatedAt: now() });
  }

  /** User said "not the same" — never auto-link these two again. */
  async rejectLink(fromKey: string, toKey: string) {
    if (!fromKey || fromKey === toKey) return;
    await this.putAlias({ alias: fromKey, target: toKey, origin: "manual", rejected: true, updatedAt: now() });
  }

  /**
   * Learning loop for item renames. One rename fixes that meal; when the *same* correction
   * (vision said X, user changed to Y) happens `promoteCorrectionsAt` times, X becomes an alias of Y,
   * so future photos are corrected automatically.
   */
  async learnCorrection(fromKey: string, toKey: string, wrongLinkTarget?: string): Promise<{ promoted: boolean; count: number }> {
    if (!fromKey || !toKey || fromKey === toKey) return { promoted: false, count: 0 };
    if (wrongLinkTarget && wrongLinkTarget !== toKey) {
      const existing = await this.getAlias(fromKey);
      if (existing && existing.target === wrongLinkTarget && !existing.rejected) await this.rejectLink(fromKey, wrongLinkTarget);
    }
    const count = await this.store.bumpCorrection(fromKey, toKey);
    if (count >= config.food.promoteCorrectionsAt) {
      await this.putAlias({ alias: fromKey, target: toKey, origin: "correction", rejected: false, updatedAt: now() });
      return { promoted: true, count };
    }
    return { promoted: false, count };
  }

  /**
   * Rename a library food. If the new name normalises to another existing food, merge into it
   * (verified entries win). The old key always becomes an alias so past lookups still resolve.
   */
  async rename(key: string, newName: string): Promise<{ food: Food; merged: boolean }> {
    const food = await this.get(key);
    if (!food) throw Object.assign(new Error("food not found"), { status: 404 });
    const newKey = foodKey(newName);
    if (!newKey) throw new Error("name has no usable words");
    if (newKey === key) {
      food.aliases = uniq([...food.aliases, food.name].filter((a) => a !== newName));
      food.name = newName; food.updatedAt = now(); food.version += 1;
      await this.put(food);
      return { food, merged: false };
    }
    const existing = await this.get(newKey);
    let result: Food;
    if (existing) {
      const keep = !existing.verified && food.verified ? { ...food, key: newKey, name: existing.name } : existing;
      keep.aliases = uniq([...existing.aliases, ...food.aliases, food.name, existing.name].filter((a) => a !== keep.name));
      keep.hits = existing.hits + food.hits;
      keep.updatedAt = now(); keep.version = existing.version + 1;
      result = keep;
    } else {
      result = { ...food, key: newKey, name: newName, aliases: uniq([...food.aliases, food.name]), updatedAt: now(), version: food.version + 1 };
    }
    await this.put(result);
    await this.remove(key);
    await this.putAlias({ alias: key, target: newKey, origin: "rename", rejected: false, updatedAt: now() });
    for (const a of await this.store.aliasesTo(key)) await this.putAlias({ ...a, target: newKey, updatedAt: now() });
    return { food: result, merged: !!existing };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];
