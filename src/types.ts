import { z } from "zod";

/* ---------------- Nutrition primitives ---------------- */
export const Macros = z.object({
  kcal: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
  fiber: z.number().min(0),
});
export type Macros = z.infer<typeof Macros>;

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export interface Ingredient { name: string; grams: number; kcal: number }

/** A canonical food in the shared library. Nutrition is always per 100 g as served. */
export interface Food {
  key: string; // normalized, token-sorted identity — see food/key.ts
  name: string; // display name
  aliases: string[]; // other display names that resolved here
  category: string;
  per100g: Macros;
  unit: { name: string; grams: number } | null; // for countables: roti, egg, idli
  ingredients: Ingredient[]; // recipe decomposition per 100 g (the "thinking" made auditable)
  assumptions: string;
  references: string[];
  confidence: Confidence;
  validation: { ok: boolean; issues: string[] };
  source: { kind: "llm" | "user" | "label"; model?: string };
  verified: boolean; // user-locked: never recomputed automatically
  hits: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Alias {
  alias: string; // key
  target: string; // key
  origin: "fuzzy" | "correction" | "manual" | "rename" | "judge";
  rejected: boolean; // user said "not the same" — never auto-link again
  updatedAt: string;
}

export interface Correction { from: string; to: string; count: number; updatedAt: string }

/* ---------------- Meals ---------------- */
export const MatchInfo = z.object({
  type: z.enum(["exact", "alias", "fuzzy", "new", "manual", "label"]),
  score: z.number().optional(),
  auto: z.boolean().optional(),
  candidateName: z.string().optional(),
});
export type MatchInfo = z.infer<typeof MatchInfo>;

export const MealItem = z.object({
  id: z.string(),
  seenName: z.string().default(""), // what the vision model saw / user first typed
  query: z.string().default(""), // the name this item was looked up under
  lookupKey: z.string().default(""), // key derived from the identified name
  key: z.string().default(""), // key of the food actually used ("" for one-off manual items)
  name: z.string(),
  portion: z.string().default(""),
  grams: z.number().min(0),
  isAddon: z.boolean().default(false),
  per100g: Macros.nullable().default(null), // snapshot at log time
  totals: Macros,
  match: MatchInfo,
  confidence: Confidence.default("medium"),
});
export type MealItem = z.infer<typeof MealItem>;

export const MealInput = z.object({
  id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ts: z.number().optional(),
  mealType: z.enum(["Breakfast", "Lunch", "Snack", "Dinner", "Pre-workout", "Post-workout"]),
  name: z.string().min(1),
  note: z.string().default(""),
  source: z.enum(["photo", "describe", "manual"]),
  thumb: z.string().nullable().default(null),
  items: z.array(MealItem).min(1),
});
export type MealInput = z.infer<typeof MealInput>;
export interface Meal extends MealInput { id: string; uid: string; ts: number; totals: Macros }

/* ---------------- Body, days, activity ---------------- */
export const Profile = z.object({
  weightKg: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  age: z.number().int().positive().optional(),
  sex: z.enum(["male", "female"]).optional(),
  bodyFatPct: z.number().min(3).max(60).optional(),
  athlete: z.boolean().optional(),
});
export type Profile = z.infer<typeof Profile>;

export const PresetId = z.enum(["idle", "recovery", "easy", "normal", "hard"]);
export type PresetId = z.infer<typeof PresetId>;

export const PresetOverride = z.object({
  neat: z.number().min(1).max(2).optional(),
  defaultExerciseKcal: z.number().min(0).max(3000).optional(),
  fatPct: z.number().min(0.1).max(0.5).optional(),
  proteinDeltaGPerKg: z.number().min(-1).max(1).optional(),
});

export const Goal = z.object({
  type: z.enum(["cut", "maintain", "bulk"]).default("maintain"),
  ratePctPerWeek: z.number().min(0).max(1.5).default(0.5), // % body weight per week
});
export type Goal = z.infer<typeof Goal>;

export const Settings = z.object({
  goal: Goal.default({ type: "maintain", ratePctPerWeek: 0.5 }),
  presets: z.partialRecord(PresetId, PresetOverride).default({}),
  defaultPreset: PresetId.default("normal"),
  eatBack: z.number().min(0).max(1).default(0.85), // share of wearable-estimated exercise calories to eat back
  tz: z.string().default("Asia/Kolkata"),
  models: z.object({
    mode: z.enum(["auto", "manual"]).default("auto"),
    vision: z.string().optional(),
    reasoning: z.string().optional(),
  }).default({ mode: "auto" }),
});
export type Settings = z.infer<typeof Settings>;

export interface StravaAuth {
  athleteId: number;
  athleteName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
  scope: string;
}

export interface User {
  uid: string;
  profile: Profile;
  settings: Settings;
  strava: StravaAuth | null;
  createdAt: string;
  updatedAt: string;
}

export const ActivityInput = z.object({
  name: z.string().default("Workout"),
  sport: z.string().default("Workout"),
  minutes: z.number().positive().max(1440),
  avgHr: z.number().positive().max(230).optional(),
  kcal: z.number().min(0).max(10000).optional(), // from a watch, if known
  distanceKm: z.number().min(0).optional(),
  elevationM: z.number().min(0).optional(),
});
export type ActivityInput = z.infer<typeof ActivityInput>;

export interface Activity {
  id: string;
  source: "strava" | "manual";
  externalId?: string;
  name: string;
  sport: string;
  minutes: number;
  avgHr?: number;
  kcalGross: number;
  kcalNet: number; // gross minus the resting burn already counted in BMR
  method: "device" | "power" | "acsm" | "hr" | "met" | "manual";
  sufferScore?: number;
}

export interface Day {
  uid: string;
  date: string;
  preset: PresetId | null; // null = follow suggestion/default
  activities: Activity[];
  stravaSyncedAt: string | null;
}

export interface Weight { uid: string; date: string; kg: number }
