import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { foodKey } from "../food/key.js";
import type { FoodRepo, Resolution } from "../food/repo.js";
import { resolveModels, type ResolvedModels } from "../llm/models.js";
import type { ChatPart, LLM, Usage } from "../llm/types.js";
import { now } from "../storage/store.js";
import type { Confidence, Food, MatchInfo, MealItem, Settings } from "../types.js";
import { fixupUser, IDENTIFY_SYSTEM, NUTRITION_SYSTEM, nutritionUser } from "./prompts.js";
import { IdentifyOut, NutritionOut } from "./schemas.js";
import { scale, validateNutrition } from "./validate.js";

export interface Ctx { apiKey?: string; settings: Settings }

interface ItemRequest {
  name: string;
  seenName?: string;
  lookupKey?: string;
  grams?: number;
  count?: number | null;
  portion?: string;
  isAddon?: boolean;
  confidence?: Confidence;
}

export interface AnalyzeResult {
  mealName: string;
  notes: string;
  items: MealItem[];
  models: ResolvedModels;
  usage: Usage;
  stats: { items: number; cacheHits: number; computed: number; suggestions: number; ms: number };
  warnings: string[];
}

const addUsage = (a: Usage, b: Usage | null) => {
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    costUsd: a.costUsd != null && b.costUsd != null ? a.costUsd + b.costUsd : null,
  };
};
const zeroUsage = (): Usage => ({ promptTokens: 0, completionTokens: 0, costUsd: 0 });
const titleCase = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

export class NutritionService {
  /** Coalesces concurrent computations of the same food inside this process. */
  private inflight = new Map<string, Promise<Food | null>>();

  constructor(private repo: FoodRepo, private llm: LLM) {}

  models(ctx: Ctx) { return resolveModels(this.llm, ctx.settings, ctx.apiKey); }

  /** Photo and/or text → itemised meal with per-item provenance (cache / new / fuzzy). */
  async analyze(input: { image?: string; mediaType?: string; note?: string }, ctx: Ctx): Promise<AnalyzeResult> {
    const t0 = Date.now();
    const models = await this.models(ctx);
    const note = (input.note || "").trim();
    const user: ChatPart[] = [];
    if (input.image) user.push({ type: "image_url", image_url: { url: `data:${input.mediaType || "image/jpeg"};base64,${input.image}` } });
    user.push({
      type: "text",
      text: input.image ? `Identify this meal.${note ? `\nUser note: ${note}` : ""}` : `No photo. Identify the meal from this description: ${note}`,
    });

    const id = await this.llm.json({ apiKey: ctx.apiKey, model: models.vision, system: IDENTIFY_SYSTEM, user, schema: IdentifyOut, schemaName: "identify" });
    let usage = addUsage(zeroUsage(), id.usage);

    const { items, usage: u2, warnings, stats } = await this.resolveMany(
      id.data.items.map((i) => ({
        name: i.canonical_name || i.seen_name, seenName: i.seen_name, grams: i.grams, count: i.count,
        portion: i.portion, isAddon: i.is_addon, confidence: i.confidence,
      })),
      ctx, models,
    );
    usage = addUsage(usage, u2);
    return { mealName: id.data.meal_name, notes: id.data.notes, items, models, usage, warnings, stats: { ...stats, ms: Date.now() - t0 } };
  }

  private async resolveMany(reqs: ItemRequest[], ctx: Ctx, models: ResolvedModels) {
    const resolutions = await Promise.all(reqs.map((r) => this.repo.resolve(r.name, { apiKey: ctx.apiKey })));
    const misses = new Map<string, { key: string; name: string; context: string }>();
    resolutions.forEach((res, i) => {
      if (res.kind === "miss" && res.lookupKey && !misses.has(res.lookupKey)) {
        const r = reqs[i];
        misses.set(res.lookupKey, { key: res.lookupKey, name: r.name, context: [r.portion, r.grams ? `${Math.round(r.grams)} g` : ""].filter(Boolean).join(", ") });
      }
    });
    const { foods, usage, warnings } = await this.compute([...misses.values()], ctx, models);

    const items: MealItem[] = [];
    let cacheHits = 0, suggestions = 0;
    for (let i = 0; i < reqs.length; i++) {
      const res = resolutions[i], req = reqs[i];
      let food: Food | null = null;
      let match: MatchInfo;
      if (res.kind === "hit") { food = res.food; match = res.match; cacheHits++; }
      else if (res.kind === "suggest") { food = res.food; match = res.match; suggestions++; }
      else { food = foods.get(res.lookupKey) ?? null; match = { type: "new" }; }
      if (food) {
        if (res.kind === "hit") void this.repo.recordHit(food).catch(() => {});
        items.push(this.itemFrom(food, req, match, res.lookupKey));
      } else {
        warnings.push(`Couldn't compute "${req.name}" — enter its values manually.`);
        items.push(this.blankItem(req, res.lookupKey));
      }
    }
    return { items, usage, warnings, stats: { items: items.length, cacheHits, computed: foods.size, suggestions } };
  }

  /** Cache misses → reasoning model (batched) → validation → one self-repair round → library. */
  async compute(list: Array<{ key: string; name: string; context: string }>, ctx: Ctx, models?: ResolvedModels) {
    const foods = new Map<string, Food>();
    const warnings: string[] = [];
    let usage = zeroUsage();
    if (!list.length) return { foods, usage, warnings };
    models ??= await this.models(ctx);

    const todo: typeof list = [];
    const waits: Array<Promise<void>> = [];
    for (const it of list) {
      const p = this.inflight.get(it.key);
      if (p) waits.push(p.then((f) => { if (f) foods.set(it.key, f); }));
      else todo.push(it);
    }

    if (todo.length) {
      const job = this.computeBatch(todo, ctx, models);
      const perKey = new Map(todo.map((t) => [t.key, job.then((r) => r.foods.get(t.key) ?? null)]));
      for (const [k, p] of perKey) this.inflight.set(k, p);
      try {
        const r = await job;
        r.foods.forEach((f, k) => foods.set(k, f));
        usage = addUsage(usage, r.usage);
        warnings.push(...r.warnings);
      } catch (e) {
        warnings.push(`Nutrition model failed: ${(e as Error).message}`);
      } finally {
        for (const k of perKey.keys()) this.inflight.delete(k);
      }
    }
    await Promise.all(waits);
    return { foods, usage, warnings };
  }

  private async computeBatch(todo: Array<{ key: string; name: string; context: string }>, ctx: Ctx, models: ResolvedModels) {
    const byId = new Map(todo.map((t, i) => [`f${i + 1}`, t]));
    const call = (text: string) => this.llm.json({
      apiKey: ctx.apiKey, model: models.reasoning, system: NUTRITION_SYSTEM,
      user: [{ type: "text", text }], schema: NutritionOut, schemaName: "nutrition", reasoning: true, maxTokens: 8000,
    });

    const first = await call(nutritionUser([...byId].map(([id, t]) => ({ id, name: t.name, context: t.context }))));
    let usage = addUsage(zeroUsage(), first.usage);
    const results = new Map(first.data.foods.filter((f) => byId.has(f.id)).map((f) => [f.id, f]));

    // Validate; ask the model to re-derive anything that fails the arithmetic checks.
    const failing = [...results].map(([id, f]) => ({ id, f, v: validateNutrition(f.per100g, f.ingredients) })).filter((x) => !x.v.ok);
    const missing = [...byId.keys()].filter((id) => !results.has(id));
    if (failing.length || missing.length) {
      try {
        const retry = await call(fixupUser([
          ...failing.map((x) => ({ id: x.id, name: byId.get(x.id)!.name, issues: x.v.issues })),
          ...missing.map((id) => ({ id, name: byId.get(id)!.name, issues: ["missing from your previous answer"] })),
        ]));
        usage = addUsage(usage, retry.usage);
        for (const f of retry.data.foods) {
          if (!byId.has(f.id)) continue;
          const prev = results.get(f.id);
          const ok = validateNutrition(f.per100g, f.ingredients).ok;
          if (!prev || ok) results.set(f.id, f);
        }
      } catch { /* keep first-pass numbers, flagged */ }
    }

    // Judge: a confident "too_low / too_high" on a food that passed the arithmetic gets one recompute.
    const judge = this.repo.judge;
    const implausible = new Set<string>();
    if (judge) {
      const flagged = async (f: NutritionOut["foods"][number]) => {
        const v = await judge.plausibility({ name: f.canonical_name, per100g: f.per100g, unit: f.unit }, ctx.apiKey).catch(() => null);
        return !!v && v.verdict !== "ok" && v.p >= config.judge.plausible ? v.verdict : null;
      };
      const checked = await Promise.all([...results].filter(([, f]) => validateNutrition(f.per100g, f.ingredients).ok).map(async ([id, f]) => [id, await flagged(f)] as const));
      const bad = checked.filter(([, v]) => v);
      if (bad.length) {
        try {
          const retry = await call(fixupUser(bad.map(([id, v]) => ({ id, name: byId.get(id)!.name, issues: [`judge: energy density looks ${v === "too_high" ? "too high" : "too low"} for this food`] }))));
          usage = addUsage(usage, retry.usage);
          for (const f of retry.data.foods) if (byId.has(f.id) && validateNutrition(f.per100g, f.ingredients).ok) results.set(f.id, f);
        } catch { /* keep first-pass numbers */ }
        for (const [id] of bad) if (await flagged(results.get(id)!)) implausible.add(id);
      }
    }

    const foods = new Map<string, Food>();
    const warnings: string[] = [];
    for (const [id, f] of results) {
      const t = byId.get(id)!;
      const validation = validateNutrition(f.per100g, f.ingredients);
      if (implausible.has(id)) { validation.ok = false; validation.issues.push("judge: implausible energy density"); }
      const modelKey = foodKey(f.canonical_name);
      const food: Food = {
        key: t.key,
        name: modelKey === t.key ? titleCase(f.canonical_name) : titleCase(t.name),
        aliases: modelKey && modelKey !== t.key ? [titleCase(f.canonical_name)] : [],
        category: f.category,
        per100g: f.per100g,
        unit: f.unit && f.unit.grams > 0 ? f.unit : null,
        ingredients: f.ingredients,
        assumptions: f.assumptions,
        references: f.references,
        confidence: validation.ok ? f.confidence : "low",
        validation,
        source: { kind: "llm", model: first.model },
        verified: false,
        hits: 1,
        createdAt: now(),
        updatedAt: now(),
        version: 1,
      };
      if (!validation.ok) warnings.push(`"${food.name}" failed checks (${validation.issues[0]}) — review it.`);
      await this.repo.put(food);
      // The model's own canonical name also points here, so it resolves next time.
      if (modelKey && modelKey !== t.key && !(await this.repo.get(modelKey))) {
        await this.repo.putAlias({ alias: modelKey, target: t.key, origin: "fuzzy", rejected: false, updatedAt: now() });
      }
      foods.set(t.key, food);
    }
    return { foods, usage, warnings };
  }

  /**
   * Resolve a single item by name — used for renames, "not the same" and added items.
   * Renames feed the correction-learning loop (vision said X → user says Y).
   */
  async resolveItem(input: {
    name: string; grams?: number; count?: number | null; seenName?: string; lookupKey?: string;
    previousKey?: string; rejectKey?: string; confirmKey?: string; portion?: string; isAddon?: boolean;
  }, ctx: Ctx) {
    const newKey = foodKey(input.name);
    const lookupKey = input.lookupKey || newKey;
    const req: ItemRequest = { ...input, seenName: input.seenName || input.name };
    let learned: { promoted: boolean; count: number } | null = null;

    if (input.confirmKey) {
      await this.repo.confirmLink(lookupKey, input.confirmKey);
      const food = await this.repo.get(input.confirmKey);
      if (food) return { item: this.itemFrom(food, req, { type: "alias", candidateName: food.name }, lookupKey), learned, usage: zeroUsage() };
    }
    if (input.rejectKey) await this.repo.rejectLink(newKey, input.rejectKey);
    if (input.lookupKey && newKey && newKey !== input.lookupKey) {
      learned = await this.repo.learnCorrection(input.lookupKey, newKey, input.previousKey);
    }

    const res: Resolution = await this.repo.resolve(input.name, { fuzzy: "strict", rejectKeys: input.rejectKey ? [input.rejectKey] : [], apiKey: ctx.apiKey });
    if (res.kind === "hit") return { item: this.itemFrom(res.food, req, res.match, lookupKey), learned, usage: zeroUsage() };

    const { foods, usage, warnings } = await this.compute([{ key: res.lookupKey, name: input.name, context: input.portion || "" }], ctx);
    const food = foods.get(res.lookupKey);
    if (!food) throw new Error(warnings[0] || "could not compute this food");
    return { item: this.itemFrom(food, req, { type: "new" }, lookupKey), learned, usage };
  }

  /** Re-derive a library food (e.g. after improving prompts or switching models). Verified foods need force. */
  async recompute(key: string, ctx: Ctx, force = false, edit?: { recipe?: Array<{ name: string; grams: number }>; note?: string }): Promise<Food> {
    const old = await this.repo.get(key);
    if (!old) throw Object.assign(new Error("food not found"), { status: 404 });
    if (old.verified && !force) throw Object.assign(new Error("food is verified — pass force to recompute"), { status: 409 });
    const models = await this.models(ctx);
    const context = [
      edit?.recipe?.length ? `user recipe, grams per 100 g of finished dish: ${edit.recipe.map((i) => `${i.name} ${Math.round(i.grams * 10) / 10} g`).join(", ")}` : "",
      edit?.note?.trim() ? `user note: ${edit.note.trim()}` : "",
    ].filter(Boolean).join(". ");
    const r = await this.computeBatch([{ key, name: old.name, context }], ctx, models);
    const fresh = r.foods.get(key);
    if (!fresh) throw new Error(r.warnings[0] || "recompute failed");
    const merged: Food = { ...fresh, aliases: [...new Set([...old.aliases, ...fresh.aliases])], hits: old.hits, createdAt: old.createdAt, version: old.version + 1, verified: false };
    await this.repo.put(merged);
    return merged;
  }

  itemFrom(food: Food, req: ItemRequest, match: MatchInfo, lookupKey: string): MealItem {
    const grams = req.grams && req.grams > 0 ? req.grams
      : req.count && food.unit ? req.count * food.unit.grams
      : food.unit?.grams ?? 100;
    return {
      id: randomUUID(),
      seenName: req.seenName || req.name,
      query: req.name,
      lookupKey,
      key: food.key,
      name: food.name,
      portion: req.portion || (food.unit && req.count ? `${req.count} × ${food.unit.name}` : ""),
      grams: Math.round(grams),
      isAddon: !!req.isAddon,
      per100g: food.per100g,
      totals: scale(food.per100g, grams),
      match,
      confidence: req.confidence ?? food.confidence,
    };
  }

  private blankItem(req: ItemRequest, lookupKey: string): MealItem {
    return {
      id: randomUUID(), seenName: req.seenName || req.name, query: req.name, lookupKey, key: "", name: titleCase(req.name), portion: req.portion || "",
      grams: Math.round(req.grams || 0), isAddon: !!req.isAddon, per100g: null,
      totals: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, match: { type: "manual" }, confidence: "low",
    };
  }
}
