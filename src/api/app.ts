import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { config, isDevOpen } from "../config.js";
import { computeAdaptive, type AdaptiveResult } from "../energy/adaptive.js";
import { computeBmr, computeTargets, profileMissing, estimateActivity, PRESET_ORDER, presetsFor, suggestPreset } from "../energy/energy.js";
import { foodKey } from "../food/key.js";
import type { FoodRepo } from "../food/repo.js";
import { LLMError, type LLM } from "../llm/types.js";
import type { Ctx, NutritionService } from "../nutrition/pipeline.js";
import { sumMacros, validateNutrition } from "../nutrition/validate.js";
import { getJSON, setJSON, type Cache } from "../storage/cache.js";
import { accessFor, hostedKey, mountHosted, type HostedDeps } from "../hosted/routes.js";
import { now, type Store } from "../storage/store.js";
import * as strava from "../strava/strava.js";
import {
  ActivityInput, Macros, MealInput, PresetId, Profile, Settings,
  type Activity, type Day, type Food, type Meal, type User,
} from "../types.js";
import { addDays, eachDay, todayIn } from "../util/date.js";

export interface Deps {
  store: Store; cache: Cache; repo: FoodRepo; nutrition: NutritionService; llm: LLM; webRoot: string;
  /** Present in hosted mode: sign-up, sessions, a food library per user, metered platform key. */
  hosted?: HostedDeps;
}

type Env = { Variables: { uid: string } };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function buildApp(d: Deps) {
  const app = new Hono<Env>();
  const { store, cache, repo, nutrition, llm } = d;

  /* ---------------- errors ---------------- */
  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400);
    if (err instanceof LLMError) return c.json({ error: err.message }, err.status as 400);
    const status = (err as { status?: number }).status;
    console.error(err);
    return c.json({ error: err.message || "server error" }, (status && status >= 400 && status < 600 ? status : 500) as 500);
  });

  // First, so it also covers the hosted sign-in and webhook routes registered below.
  app.use("/api/*", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: "payload too large" }, 413) }));

  /* ---------------- auth ---------------- */
  const hosted = d.hosted;
  if (hosted) mountHosted(app, hosted, store);
  else app.use("/api/*", async (c, next) => {
    const p = c.req.path;
    if (p === "/api/health" || p === "/api/strava/callback" || p === "/api/strava/connect") return next();
    const token = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "") || c.req.header("x-app-token") || "";
    const uid = config.tokens.get(token) ?? (isDevOpen() ? "me" : null);
    if (!uid) return c.json({ error: "Wrong or missing app token — set it in Settings." }, 401);
    c.set("uid", uid);
    return next();
  });

  /* ---------------- helpers ---------------- */
  const defaultUser = (uid: string): User => ({ uid, profile: {}, settings: Settings.parse({}), strava: null, createdAt: now(), updatedAt: now() });
  async function user(uid: string): Promise<User> {
    const u = await store.getUser(uid);
    if (!u) { const nu = defaultUser(uid); await store.putUser(nu); return nu; }
    u.settings = Settings.parse(u.settings ?? {}); // migrate older docs to current defaults
    return u;
  }
  // Whose food library a request uses: one shared library self-hosted, the user's own when hosted.
  const libOf = (c: Context<Env>) => (hosted ? c.get("uid") : "");
  const repoOf = (c: Context<Env>) => repo.for(libOf(c));
  const ownKey = (c: Context<Env>) => c.req.header("x-openrouter-key")?.trim() || undefined;

  /** Context for a request that may call the AI. Hosted: own key, or the platform key if the plan allows it (metered). */
  function ctxOf(c: Context<Env>, u: User): Ctx {
    if (!hosted) return { apiKey: ownKey(c), settings: u.settings, lib: "" };
    const { apiKey } = hostedKey(hosted, u.uid, ownKey(c));
    // On the platform key the models are always picked automatically, so nobody can route paid calls to an expensive model.
    const settings = apiKey && apiKey === hosted.platformKey ? { ...u.settings, models: { mode: "auto" as const } } : u.settings;
    return { apiKey, settings, lib: u.uid };
  }
  const bump = (uid: string) => cache.incr(`ver:${uid}`);
  const ver = async (uid: string) => (await cache.get(`ver:${uid}`)) || "0";
  const json = async <T>(c: Context<Env>, schema: z.ZodType<T>) => schema.parse(await c.req.json().catch(() => ({})));

  async function adaptiveFor(u: User, date: string): Promise<AdaptiveResult> {
    const key = `adapt:${u.uid}:${date}:${await ver(u.uid)}`;
    const hot = await getJSON<AdaptiveResult>(cache, key);
    if (hot) return hot;
    const from = addDays(date, -28), to = addDays(date, -1);
    const [meals, weights, days] = await Promise.all([store.listMeals(u.uid, from, to), store.listWeights(u.uid, from, to), store.listDays(u.uid, from, to)]);
    const intake = new Map<string, number>();
    for (const m of meals) intake.set(m.date, (intake.get(m.date) ?? 0) + m.totals.kcal);
    const wByDate = new Map(weights.map((w) => [w.date, w.kg]));
    const dByDate = new Map(days.map((x) => [x.date, x]));
    const series = eachDay(from, to).map((date) => {
      const day = dByDate.get(date);
      const acts = day?.activities ?? [];
      const presetId = day?.preset ?? suggestPreset(acts) ?? u.settings.defaultPreset;
      const t = computeTargets({ profile: { ...u.profile, weightKg: wByDate.get(date) ?? u.profile.weightKg }, settings: u.settings, presetId, activities: acts });
      return { date, intake: intake.get(date) ?? null, weight: wByDate.get(date) ?? null, formulaTdee: t.tdeeFormula };
    });
    const res = computeAdaptive(series);
    await setJSON(cache, key, res, 900);
    return res;
  }

  async function syncStrava(u: User, date: string): Promise<Day> {
    if (!u.strava) throw Object.assign(new Error("Strava not connected"), { status: 400 });
    const { auth, refreshed } = await strava.ensureFresh(u.strava);
    if (refreshed) { u.strava = auth; u.updatedAt = now(); await store.putUser(u); }
    const acts = await strava.fetchDay(auth, date, u.settings.tz, u.profile, computeBmr(u.profile).kcal);
    const day = (await store.getDay(u.uid, date)) ?? { uid: u.uid, date, preset: null, activities: [], stravaSyncedAt: null };
    day.activities = [...day.activities.filter((a) => a.source !== "strava"), ...acts];
    day.stravaSyncedAt = now();
    await store.putDay(day);
    await bump(u.uid);
    return day;
  }

  async function dayView(u: User, date: string, opts: { autoSync?: boolean } = {}) {
    let day = await store.getDay(u.uid, date);
    const stale = !day?.stravaSyncedAt || Date.now() - Date.parse(day.stravaSyncedAt) > 30 * 60_000;
    const warnings: string[] = [];
    if (opts.autoSync && u.strava && strava.stravaEnabled() && stale && date >= addDays(todayIn(u.settings.tz), -1)) {
      try { day = await syncStrava(u, date); } catch (e) { warnings.push((e as Error).message); }
    }
    const [meals, weights, adaptive] = await Promise.all([
      store.listMeals(u.uid, date, date), store.listWeights(u.uid, addDays(date, -30), date), adaptiveFor(u, date),
    ]);
    const activities = day?.activities ?? [];
    const suggested = suggestPreset(activities);
    const presetId = day?.preset ?? suggested ?? u.settings.defaultPreset;
    const latestWeight = [...weights].reverse()[0];
    const profile = { ...u.profile, weightKg: latestWeight?.kg ?? u.profile.weightKg };
    const targets = computeTargets({ profile, settings: u.settings, presetId, activities, adaptiveK: adaptive.k });
    const trendToday = adaptive.trend.at(-1)?.trend ?? null;
    return {
      date, presetId, presetSource: day?.preset ? "manual" : suggested ? "activities" : "default", suggested,
      presets: PRESET_ORDER.map((id) => { const p = presetsFor(u.settings)[id]; return { id, label: p.label, blurb: p.blurb }; }),
      meals, totals: sumMacros(meals.map((m) => m.totals)), targets, activities,
      adaptive: { ready: adaptive.ready, k: adaptive.k, observedTdee: adaptive.observedTdee, confidence: adaptive.confidence, reason: adaptive.reason, loggedDays: adaptive.loggedDays, weighIns: adaptive.weighIns },
      weight: { today: weights.find((w) => w.date === date)?.kg ?? null, latest: latestWeight?.kg ?? null, trend: trendToday },
      strava: { enabled: strava.stravaEnabled(), connected: !!u.strava, syncedAt: day?.stravaSyncedAt ?? null },
      goal: u.settings.goal, warnings,
    };
  }

  const foodSummary = (f: Food) => ({
    key: f.key, name: f.name, category: f.category, per100g: f.per100g, unit: f.unit, verified: f.verified,
    confidence: f.confidence, hits: f.hits, ok: f.validation.ok, aliases: f.aliases, updatedAt: f.updatedAt,
  });

  /* ---------------- health / me ---------------- */
  app.get("/api/health", (c) => c.json({ ok: true, store: store.kind, cache: cache.kind, llm: llm.kind, strava: strava.stravaEnabled() }));

  // Everything the user owns, as one JSON file: the way out for self-hosters.
  app.get("/api/export", async (c) => {
    const uid = c.get("uid");
    const [meals, weights, days, foods] = await Promise.all([
      store.listMeals(uid, "0000-01-01", "9999-12-31"),
      store.listWeights(uid, "0000-01-01", "9999-12-31"),
      store.listDays(uid, "0000-01-01", "9999-12-31"),
      repoOf(c).library.listFoods({ limit: 1_000_000 }),
    ]);
    c.header("content-disposition", `attachment; filename="macrosnap-export-${now().slice(0, 10)}.json"`);
    return c.json({ exportedAt: now(), uid, user: await user(uid), meals, weights, days, foods });
  });

  app.get("/api/me", async (c) => {
    const u = await user(c.get("uid"));
    return c.json({
      uid: u.uid, profile: u.profile, settings: u.settings, presets: presetsFor(u.settings), presetOrder: PRESET_ORDER,
      bmr: computeBmr(u.profile), profileMissing: profileMissing(u.profile), strava: { enabled: strava.stravaEnabled(), connected: !!u.strava, athlete: u.strava?.athleteName ?? null },
      serverHasOpenRouterKey: hosted ? true : !!config.openrouterKey, llm: llm.kind, hosted: !!hosted,
    });
  });

  app.put("/api/me", async (c) => {
    const u = await user(c.get("uid"));
    const body = await json(c, z.object({ profile: Profile.optional(), settings: Settings.partial().optional() }));
    if (body.profile) u.profile = body.profile;
    if (body.settings) u.settings = Settings.parse({ ...u.settings, ...body.settings });
    u.updatedAt = now();
    await store.putUser(u);
    await bump(u.uid);
    return c.json({ ok: true, profile: u.profile, settings: u.settings, bmr: computeBmr(u.profile), profileMissing: profileMissing(u.profile), presets: presetsFor(u.settings) });
  });

  /* ---------------- models ---------------- */
  app.get("/api/models", async (c) => {
    const cap = c.req.query("cap");
    const models = await llm.listModels(ownKey(c));
    return c.json(models
      .filter((m) => cap !== "vision" || m.inputModalities.includes("image"))
      .map((m) => ({ id: m.id, name: m.name, inPerM: +(m.promptPrice * 1e6).toFixed(3), outPerM: +(m.completionPrice * 1e6).toFixed(3), structured: m.supported.includes("structured_outputs"), reasoning: m.supported.includes("reasoning") }))
      .sort((a, b) => a.id.localeCompare(b.id)));
  });
  app.get("/api/models/resolved", async (c) => c.json(await nutrition.models(ctxOf(c, await user(c.get("uid"))))));

  /* ---------------- analysis ---------------- */
  app.post("/api/analyze", async (c) => {
    const u = await user(c.get("uid"));
    const body = await json(c, z.object({ image: z.string().optional(), mediaType: z.string().optional(), note: z.string().optional() }));
    if (!body.image && !body.note?.trim()) return c.json({ error: "Send a photo or a description." }, 400);
    const ctx = ctxOf(c, u);
    if (hosted && !ctx.apiKey) {
      const a = hosted.accounts.get(u.uid)!;
      return c.json({ error: accessFor(hosted, a).reason, code: "paywall" }, 402);
    }
    const res = await nutrition.analyze(body, ctx);
    // A free photo is used up only when it ran on the platform key.
    if (hosted && ctx.apiKey === hosted.platformKey) hosted.accounts.record({ uid: u.uid, kind: "photo", tier: accessFor(hosted, hosted.accounts.get(u.uid)!).paid ? "paid" : "free" });
    return c.json(res);
  });

  app.post("/api/resolve", async (c) => {
    const u = await user(c.get("uid"));
    const body = await json(c, z.object({
      name: z.string().min(1), grams: z.number().min(0).optional(), count: z.number().nullable().optional(),
      seenName: z.string().optional(), lookupKey: z.string().optional(), previousKey: z.string().optional(),
      rejectKey: z.string().optional(), confirmKey: z.string().optional(), portion: z.string().optional(), isAddon: z.boolean().optional(),
    }));
    return c.json(await nutrition.resolveItem(body, ctxOf(c, u)));
  });

  /* ---------------- food library ---------------- */
  /** How many saved meals use each food. Counted from the meals themselves, so deleting or editing a meal is reflected. */
  async function loggedCounts(uid: string): Promise<Map<string, number>> {
    const n = new Map<string, number>();
    for (const m of await store.listMeals(uid, "0000-01-01", "9999-12-31"))
      for (const k of new Set(m.items.map((i) => i.key).filter(Boolean))) n.set(k, (n.get(k) ?? 0) + 1);
    return n;
  }

  app.get("/api/foods", async (c) => {
    const [foods, counts] = await Promise.all([
      repoOf(c).library.listFoods({ q: c.req.query("q"), limit: Number(c.req.query("limit") || 200) }),
      loggedCounts(c.get("uid")),
    ]);
    const rows = foods.map((f) => ({ ...foodSummary(f), hits: counts.get(f.key) ?? 0 }));
    // Search results keep their relevance order; the plain list shows what you log most first.
    if (!c.req.query("q")) rows.sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));
    return c.json(rows);
  });

  app.get("/api/foods/:key", async (c) => {
    const r = repoOf(c);
    const f = await r.get(c.req.param("key"));
    if (!f) return c.json({ error: "not found" }, 404);
    const [linkedAliases, counts] = await Promise.all([r.library.aliasesTo(f.key), loggedCounts(c.get("uid"))]);
    return c.json({ ...f, hits: counts.get(f.key) ?? 0, linkedAliases });
  });

  app.post("/api/foods", async (c) => {
    const body = await json(c, z.object({ name: z.string().min(1), per100g: Macros, unit: z.object({ name: z.string(), grams: z.number().positive() }).nullable().optional(), category: z.string().optional() }));
    const key = foodKey(body.name);
    if (!key) return c.json({ error: "name has no usable words" }, 400);
    const r = repoOf(c);
    const existing = await r.get(key);
    const f: Food = {
      key, name: body.name.trim(), aliases: existing?.aliases ?? [], category: body.category ?? existing?.category ?? "custom",
      per100g: body.per100g, unit: body.unit ?? existing?.unit ?? null, ingredients: [], assumptions: "Entered by user",
      references: ["user"], confidence: "high", validation: validateNutrition(body.per100g), source: { kind: "user" },
      verified: true, hits: existing?.hits ?? 0, createdAt: existing?.createdAt ?? now(), updatedAt: now(), version: (existing?.version ?? 0) + 1,
    };
    await r.put(f);
    return c.json(f);
  });

  app.put("/api/foods/:key", async (c) => {
    const body = await json(c, z.object({
      name: z.string().min(1).optional(), per100g: Macros.optional(), unit: z.object({ name: z.string(), grams: z.number().positive() }).nullable().optional(),
      verified: z.boolean().optional(), category: z.string().optional(),
    }));
    const r = repoOf(c);
    let key = c.req.param("key");
    let merged = false;
    if (body.name) { const rn = await r.rename(key, body.name); key = rn.food.key; merged = rn.merged; }
    const f = await r.get(key);
    if (!f) return c.json({ error: "not found" }, 404);
    if (body.per100g) { f.per100g = body.per100g; f.validation = validateNutrition(f.per100g); f.source = { kind: "user" }; f.verified = true; }
    if (body.unit !== undefined) f.unit = body.unit;
    if (body.category) f.category = body.category;
    if (body.verified !== undefined) f.verified = body.verified;
    f.updatedAt = now(); f.version += 1;
    await r.put(f);
    return c.json({ food: f, merged });
  });

  app.post("/api/foods/:key/recompute", async (c) => {
    const u = await user(c.get("uid"));
    const { force, recipe, note } = await json(c, z.object({
      force: z.boolean().default(false),
      recipe: z.array(z.object({ name: z.string().trim().min(1).max(80), grams: z.number().positive().max(1000) })).max(40).optional(),
      note: z.string().max(300).optional(),
    }));
    return c.json(await nutrition.recompute(c.req.param("key"), ctxOf(c, u), force, { recipe, note }));
  });

  app.delete("/api/foods/:key", async (c) => { await repoOf(c).remove(c.req.param("key")); return c.json({ ok: true }); });

  /* ---------------- meals ---------------- */
  app.post("/api/meals", async (c) => {
    const uid = c.get("uid");
    const input = await json(c, MealInput);
    const prev = input.id ? await store.getMeal(uid, input.id) : null;
    const meal: Meal = { ...input, id: input.id ?? randomUUID(), uid, ts: input.ts ?? prev?.ts ?? Date.now(), totals: sumMacros(input.items.map((i) => i.totals)) };
    await store.putMeal(meal);
    await bump(uid);
    return c.json(meal);
  });
  app.delete("/api/meals/:id", async (c) => { await store.deleteMeal(c.get("uid"), c.req.param("id")); await bump(c.get("uid")); return c.json({ ok: true }); });

  /* ---------------- weights ---------------- */
  app.put("/api/weights/:date", async (c) => {
    const date = c.req.param("date");
    if (!DATE.test(date)) return c.json({ error: "bad date" }, 400);
    const { kg } = await json(c, z.object({ kg: z.number().min(25).max(350) }));
    await store.putWeight({ uid: c.get("uid"), date, kg });
    // Keep the profile's weight current — it drives BMR.
    const u = await user(c.get("uid"));
    if (date >= todayIn(u.settings.tz) || !u.profile.weightKg) { u.profile.weightKg = kg; u.updatedAt = now(); await store.putUser(u); }
    await bump(c.get("uid"));
    return c.json({ ok: true });
  });
  app.delete("/api/weights/:date", async (c) => { await store.deleteWeight(c.get("uid"), c.req.param("date")); await bump(c.get("uid")); return c.json({ ok: true }); });

  /* ---------------- days / dashboard ---------------- */
  app.get("/api/day/:date", async (c) => {
    const date = c.req.param("date");
    if (!DATE.test(date)) return c.json({ error: "bad date" }, 400);
    return c.json(await dayView(await user(c.get("uid")), date, { autoSync: true }));
  });

  app.put("/api/day/:date", async (c) => {
    const uid = c.get("uid"), date = c.req.param("date");
    const { preset } = await json(c, z.object({ preset: PresetId.nullable() }));
    const day = (await store.getDay(uid, date)) ?? { uid, date, preset: null, activities: [], stravaSyncedAt: null };
    day.preset = preset;
    await store.putDay(day);
    await bump(uid);
    return c.json(await dayView(await user(uid), date));
  });

  app.post("/api/day/:date/activities", async (c) => {
    const u = await user(c.get("uid")), date = c.req.param("date");
    const a = await json(c, ActivityInput);
    const est = estimateActivity({ minutes: a.minutes, sport: a.sport, avgHr: a.avgHr, deviceKcal: a.kcal, distanceKm: a.distanceKm, elevationM: a.elevationM }, u.profile, computeBmr(u.profile).kcal);
    const act: Activity = { id: randomUUID(), source: "manual", name: a.name, sport: a.sport, minutes: a.minutes, avgHr: a.avgHr, kcalGross: est.gross, kcalNet: est.net, method: a.kcal ? "device" : est.method };
    const day = (await store.getDay(u.uid, date)) ?? { uid: u.uid, date, preset: null, activities: [], stravaSyncedAt: null };
    day.activities.push(act);
    await store.putDay(day);
    await bump(u.uid);
    return c.json(await dayView(u, date));
  });

  app.delete("/api/day/:date/activities/:id", async (c) => {
    const u = await user(c.get("uid")), date = c.req.param("date");
    const day = await store.getDay(u.uid, date);
    if (day) { day.activities = day.activities.filter((a) => a.id !== c.req.param("id")); await store.putDay(day); await bump(u.uid); }
    return c.json(await dayView(u, date));
  });

  /* ---------------- trends ---------------- */
  app.get("/api/trends", async (c) => {
    const u = await user(c.get("uid"));
    const days = Math.min(120, Math.max(7, Number(c.req.query("days") || 28)));
    const to = todayIn(u.settings.tz), from = addDays(to, -(days - 1));
    const [meals, weights, dayDocs, adaptive] = await Promise.all([
      store.listMeals(u.uid, from, to), store.listWeights(u.uid, addDays(from, -30), to), store.listDays(u.uid, from, to), adaptiveFor(u, to),
    ]);
    const intake = new Map<string, number>(), protein = new Map<string, number>();
    for (const m of meals) { intake.set(m.date, (intake.get(m.date) ?? 0) + m.totals.kcal); protein.set(m.date, (protein.get(m.date) ?? 0) + m.totals.protein); }
    const dByDate = new Map(dayDocs.map((x) => [x.date, x]));
    const wByDate = new Map(weights.map((w) => [w.date, w.kg]));
    // Weight trend over a longer window so the EWMA is warmed up at the start of the chart.
    const longTrend = computeAdaptive(eachDay(addDays(from, -30), to).map((date) => ({ date, intake: null, weight: wByDate.get(date) ?? null, formulaTdee: 2000 })), { minLogged: 0, minWeighIns: 0 }).trend;
    const tByDate = new Map(longTrend.map((t) => [t.date, t.trend]));
    const series = eachDay(from, to).map((date) => {
      const day = dByDate.get(date);
      const acts = day?.activities ?? [];
      const presetId = day?.preset ?? suggestPreset(acts) ?? u.settings.defaultPreset;
      const t = computeTargets({ profile: u.profile, settings: u.settings, presetId, activities: acts, adaptiveK: adaptive.k });
      return { date, presetId, intake: intake.get(date) ?? null, protein: protein.get(date) ?? null, target: t.target, floor: t.range.floor, ceiling: t.range.ceiling, proteinTarget: t.macros.protein, weight: wByDate.get(date) ?? null, trend: tByDate.get(date) ?? null };
    });
    const { trend: _t, ...adaptiveSummary } = adaptive;
    return c.json({ from, to, series, adaptive: adaptiveSummary });
  });

  /* ---------------- strava ---------------- */
  const redirectUri = (c: Context<Env>) => `${config.publicUrl || new URL(c.req.url).origin}/api/strava/callback`;

  app.get("/api/strava/connect", async (c) => {
    if (!strava.stravaEnabled()) return c.text("Strava isn't configured on the server (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET).", 400);
    const token = c.req.query("t") || "";
    const uid = hosted ? (c.get("uid") ?? null) : config.tokens.get(token) ?? (isDevOpen() ? "me" : null);
    if (!uid) return c.text("unauthorized", 401);
    return c.redirect(strava.authorizeUrl(strava.makeState(uid), redirectUri(c)));
  });

  app.get("/api/strava/callback", async (c) => {
    const uid = strava.readState(c.req.query("state") || "");
    if (!uid) return c.redirect("/#/settings?strava=bad_state");
    if (c.req.query("error")) return c.redirect("/#/settings?strava=denied");
    const scope = c.req.query("scope") || "";
    if (!scope.includes("activity:read")) return c.redirect("/#/settings?strava=need_activity_scope");
    const u = await user(uid);
    u.strava = await strava.exchangeCode(c.req.query("code") || "", scope);
    u.updatedAt = now();
    await store.putUser(u);
    return c.redirect("/#/settings?strava=connected");
  });

  app.post("/api/strava/sync", async (c) => {
    const u = await user(c.get("uid"));
    const { date } = await json(c, z.object({ date: z.string().regex(DATE) }));
    await syncStrava(u, date);
    return c.json(await dayView(await user(u.uid), date));
  });

  app.delete("/api/strava", async (c) => {
    const u = await user(c.get("uid"));
    if (u.strava) await strava.deauthorize(u.strava);
    u.strava = null; u.updatedAt = now();
    await store.putUser(u);
    return c.json({ ok: true });
  });

  /* ---------------- PWA ---------------- */
  // Share-target fallback if the service worker isn't active yet.
  app.post("/share", (c) => c.redirect("/?share_failed=1", 303));
  // Revalidate every static file: without this browsers heuristically cache old JS and skip new modules (e.g. the profile gate).
  app.use("/*", async (c, next) => { await next(); if (!c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-cache"); });
  app.use("/*", serveStatic({ root: d.webRoot }));
  app.get("*", serveStatic({ root: d.webRoot, path: "index.html" }));

  return app;
}
