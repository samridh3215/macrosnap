import type { Activity, PresetId, Profile, Settings } from "../types.js";

/* ============================== Day presets ============================== */

export interface Preset {
  id: PresetId;
  label: string;
  blurb: string;
  neat: number; // non-exercise multiplier on BMR (includes thermic effect of food)
  defaultExerciseKcal: number; // used when no activity is logged/synced for the day
  fatPct: number; // share of calories from fat; carbs fill what's left after protein & fat
  proteinDeltaGPerKg: number;
}

export const PRESET_ORDER: PresetId[] = ["idle", "recovery", "easy", "normal", "hard"];

export const DEFAULT_PRESETS: Record<PresetId, Preset> = {
  idle: { id: "idle", label: "Idle", blurb: "Desk day, barely moving", neat: 1.2, defaultExerciseKcal: 0, fatPct: 0.33, proteinDeltaGPerKg: 0 },
  recovery: { id: "recovery", label: "Active rest", blurb: "Recovery — walks, mobility, light yoga", neat: 1.3, defaultExerciseKcal: 150, fatPct: 0.3, proteinDeltaGPerKg: 0 },
  easy: { id: "easy", label: "Easy", blurb: "Zone 2, technique, light lifting", neat: 1.35, defaultExerciseKcal: 300, fatPct: 0.28, proteinDeltaGPerKg: 0 },
  normal: { id: "normal", label: "Normal", blurb: "Regular training session", neat: 1.375, defaultExerciseKcal: 450, fatPct: 0.25, proteinDeltaGPerKg: 0 },
  hard: { id: "hard", label: "Hard", blurb: "Intervals, long run, HYROX sim, heavy lifting", neat: 1.4, defaultExerciseKcal: 800, fatPct: 0.2, proteinDeltaGPerKg: 0.2 },
};

export function presetsFor(settings: Settings): Record<PresetId, Preset> {
  const out = structuredClone(DEFAULT_PRESETS);
  for (const id of PRESET_ORDER) Object.assign(out[id], settings.presets?.[id] ?? {});
  return out;
}

/* ============================== BMR ============================== */

export interface BmrResult {
  kcal: number;
  formula: string;
  candidates: Array<{ formula: string; kcal: number }>;
  assumptions: string[];
  weightKg: number;
  lbmKg: number | null;
}

/**
 * Pick the most accurate resting-energy formula the available data supports:
 *  body-fat % known → Katch–McArdle (or Cunningham for athletes, who carry more metabolically active mass)
 *  weight+height+age → Mifflin–St Jeor (sex-adjusted; midpoint if sex unknown)
 *  less → rougher fallbacks, with the assumption spelled out.
 */
/** Fields the app needs before targets mean anything. Body fat and athlete stay optional. */
export function profileMissing(p: Profile): Array<"weightKg" | "heightCm" | "age" | "sex"> {
  const out: Array<"weightKg" | "heightCm" | "age" | "sex"> = [];
  if (!p.weightKg) out.push("weightKg");
  if (!p.heightCm) out.push("heightCm");
  if (!p.age) out.push("age");
  if (!p.sex) out.push("sex");
  return out;
}

export function computeBmr(p: Profile): BmrResult {
  const assumptions: string[] = [];
  let w = p.weightKg;
  if (!w) { w = 70; assumptions.push("weight unknown — assumed 70 kg"); }
  const candidates: BmrResult["candidates"] = [];
  const lbm = p.bodyFatPct ? w * (1 - p.bodyFatPct / 100) : null;

  if (lbm) {
    candidates.push({ formula: "Katch–McArdle", kcal: 370 + 21.6 * lbm });
    candidates.push({ formula: "Cunningham", kcal: 500 + 22 * lbm });
  }
  const sexTerm = p.sex === "male" ? 5 : p.sex === "female" ? -161 : -78;
  if (p.heightCm) {
    const age = p.age ?? 30;
    if (!p.age && !lbm) assumptions.push("age unknown — assumed 30");
    if (!p.sex && !lbm) assumptions.push("sex unknown — used the male/female midpoint");
    candidates.push({ formula: "Mifflin–St Jeor", kcal: 10 * w + 6.25 * p.heightCm - 5 * age + sexTerm });
  }
  if (!candidates.length) {
    assumptions.push("height unknown — using a weight-only estimate (add height/age for accuracy)");
    candidates.push({ formula: "Weight-only (≈ 22–24 kcal/kg)", kcal: w * (p.sex === "male" ? 24 : p.sex === "female" ? 22 : 23) });
  }

  let chosen = candidates[candidates.length - 1];
  if (lbm) chosen = candidates.find((c) => c.formula === (p.athlete ? "Cunningham" : "Katch–McArdle"))!;
  else if (p.heightCm) chosen = candidates.find((c) => c.formula === "Mifflin–St Jeor")!;

  return {
    kcal: Math.round(chosen.kcal),
    formula: chosen.formula,
    candidates: candidates.map((c) => ({ ...c, kcal: Math.round(c.kcal) })),
    assumptions,
    weightKg: w,
    lbmKg: lbm ? Math.round(lbm * 10) / 10 : null,
  };
}

/* ============================== Activity energy ============================== */

// Compendium of Physical Activities (approx.), keyed by Strava sport_type.
const MET: Record<string, number> = {
  Run: 9.8, TrailRun: 10, VirtualRun: 9.8, Walk: 3.5, Hike: 6, Ride: 7.5, VirtualRide: 7, MountainBikeRide: 8.5,
  GravelRide: 8, EBikeRide: 4, Swim: 7, WeightTraining: 5, Crossfit: 8, Workout: 6, HighIntensityIntervalTraining: 8,
  Rowing: 7, VirtualRow: 7, Yoga: 2.5, Pilates: 3, Elliptical: 5, StairStepper: 8, Soccer: 7, Badminton: 5.5,
  Tennis: 7, Squash: 7.3, Basketball: 6.5, Cricket: 4.8, RockClimbing: 7.5, Boxing: 7.8, Kickboxing: 7.8,
  Dance: 5, Skateboard: 5, InlineSkate: 7, Kayaking: 5, Surfing: 3, Golf: 4.3,
};

export interface ActivityEstimateInput {
  minutes: number;
  sport: string;
  avgHr?: number;
  deviceKcal?: number;
  kilojoules?: number;
  distanceKm?: number;
  elevationM?: number;
}

/**
 * Gross energy of a session using the best available signal:
 *  device calories → power meter work (kJ ≈ kcal at ~24% efficiency) → ACSM metabolic equations
 *  for runs/walks with distance → Keytel heart-rate equation → MET table.
 * Net = gross minus the resting burn for that duration (already counted via BMR).
 */
export function estimateActivity(a: ActivityEstimateInput, p: Profile, bmrKcal: number): { gross: number; net: number; method: Activity["method"] } {
  const w = p.weightKg ?? 70;
  const mins = Math.max(0, a.minutes);
  let gross: number, method: Activity["method"];

  if (a.deviceKcal && a.deviceKcal > 0) { gross = a.deviceKcal; method = "device"; }
  else if (a.kilojoules && a.kilojoules > 0) { gross = a.kilojoules / (4.184 * 0.24); method = "power"; }
  else if (a.distanceKm && mins > 0 && /Run|Walk|Hike/.test(a.sport)) {
    const speed = (a.distanceKm * 1000) / mins; // m/min
    const grade = a.elevationM ? Math.min(0.15, (a.elevationM / (a.distanceKm * 1000)) * 0.5) : 0; // half of gain ≈ net uphill
    const running = /Run/.test(a.sport) || speed > 134;
    const vo2 = running ? 0.2 * speed + 0.9 * speed * grade + 3.5 : 0.1 * speed + 1.8 * speed * grade + 3.5;
    gross = ((vo2 * w) / 1000) * 5 * mins; // 5 kcal per litre O2
    method = "acsm";
  } else if (a.avgHr && a.avgHr >= 90 && p.age) {
    const male = (-55.0969 + 0.6309 * a.avgHr + 0.1988 * w + 0.2017 * p.age) / 4.184;
    const female = (-20.4022 + 0.4472 * a.avgHr - 0.1263 * w + 0.074 * p.age) / 4.184;
    const perMin = p.sex === "male" ? male : p.sex === "female" ? female : (male + female) / 2;
    gross = Math.max(0, perMin) * mins;
    method = "hr";
  } else {
    gross = (MET[a.sport] ?? 6) * w * (mins / 60);
    method = "met";
  }
  const restingDuring = (bmrKcal / 1440) * mins;
  return { gross: Math.round(gross), net: Math.round(Math.max(0, gross - restingDuring)), method };
}

/** Classify a day from its training so the right preset can be suggested. */
export function suggestPreset(activities: Activity[]): PresetId | null {
  if (!activities.length) return null;
  const net = activities.reduce((s, a) => s + a.kcalNet, 0);
  const suffer = Math.max(0, ...activities.map((a) => a.sufferScore ?? 0));
  if (net >= 800 || suffer >= 150) return "hard";
  if (net >= 450 || suffer >= 80) return "normal";
  if (net >= 200) return "easy";
  return "recovery";
}

/* ============================== Targets ============================== */

export interface DayTargets {
  preset: Preset;
  bmr: BmrResult;
  neatKcal: number;
  exercise: { kcal: number; source: "activities" | "preset-default"; eatBack: number };
  tdeeFormula: number;
  adaptive: { k: number; applied: boolean };
  tdee: number;
  goalDelta: number;
  target: number;
  range: { floor: number; bandLow: number; bandHigh: number; ceiling: number };
  macros: { protein: number; carbs: number; fat: number; fiber: number; basis: string };
  warnings: string[];
}

const SEX_FLOOR = { male: 1500, female: 1200, unknown: 1350 };

export function computeTargets(input: {
  profile: Profile; settings: Settings; presetId: PresetId; activities: Activity[]; adaptiveK?: number;
}): DayTargets {
  const { profile: p, settings: s } = input;
  const preset = presetsFor(s)[input.presetId];
  const bmr = computeBmr(p);
  const warnings = [...bmr.assumptions];
  const w = bmr.weightKg;

  // Exercise: synced/logged sessions beat the preset's default. Wearable estimates run high,
  // so only `eatBack` of them counts; power-meter work is accurate and counted fully.
  let exerciseKcal: number, source: DayTargets["exercise"]["source"];
  if (input.activities.length) {
    exerciseKcal = input.activities.reduce((sum, a) => sum + a.kcalNet * (a.method === "power" ? 1 : s.eatBack), 0);
    source = "activities";
  } else {
    exerciseKcal = preset.defaultExerciseKcal;
    source = "preset-default";
  }
  const neatKcal = bmr.kcal * preset.neat;
  const tdeeFormula = neatKcal + exerciseKcal;
  const k = input.adaptiveK ?? 1;
  const tdee = tdeeFormula * k;

  // Goal: rate is % body weight per week; 7700 kcal ≈ 1 kg of mixed tissue.
  const dailyFromRate = (s.goal.ratePctPerWeek / 100) * w * 7700 / 7;
  let goalDelta = 0;
  if (s.goal.type === "cut") {
    goalDelta = -Math.min(dailyFromRate, 0.25 * tdee);
    if (dailyFromRate > 0.25 * tdee) warnings.push("cut rate capped at a 25% deficit");
  } else if (s.goal.type === "bulk") {
    goalDelta = Math.min(dailyFromRate, 0.15 * tdee);
    if (dailyFromRate > 0.15 * tdee) warnings.push("bulk rate capped at a 15% surplus");
  }

  const floor = Math.max(bmr.kcal, SEX_FLOOR[p.sex ?? "unknown"]);
  const ceilingFactor = s.goal.type === "cut" ? 1.0 : s.goal.type === "maintain" ? 1.1 : 1.2;
  let target = tdee + goalDelta;
  if (target < floor) { warnings.push("target raised to your safe minimum (BMR)"); target = floor; }
  const ceiling = Math.max(tdee * ceilingFactor, target * 1.05);
  const bandLow = Math.max(floor, target * 0.95);
  const bandHigh = Math.min(ceiling, target * 1.05);

  // Macros: protein first (by goal; lean-mass based when body fat is known), fat by preset share
  // with a hormonal floor, carbs fill the rest — so hard days get the carbs.
  const proteinPerKg = { cut: 2.2, maintain: 1.8, bulk: 2.0 }[s.goal.type];
  const proteinPerLbm = { cut: 2.7, maintain: 2.3, bulk: 2.4 }[s.goal.type];
  let protein = bmr.lbmKg ? bmr.lbmKg * proteinPerLbm : w * proteinPerKg;
  protein += preset.proteinDeltaGPerKg * w;
  let fat = Math.max(0.7 * w, (preset.fatPct * target) / 9);
  let carbs = (target - protein * 4 - fat * 9) / 4;
  if (carbs < 0.5 * w) {
    fat = Math.max(0.5 * w, (target - protein * 4 - 0.5 * w * 4) / 9);
    carbs = Math.max(0, (target - protein * 4 - fat * 9) / 4);
    warnings.push("calories are tight — fat trimmed to protect protein");
  }

  return {
    preset,
    bmr,
    neatKcal: Math.round(neatKcal),
    exercise: { kcal: Math.round(exerciseKcal), source, eatBack: s.eatBack },
    tdeeFormula: Math.round(tdeeFormula),
    adaptive: { k: Math.round(k * 1000) / 1000, applied: k !== 1 },
    tdee: Math.round(tdee),
    goalDelta: Math.round(goalDelta),
    target: Math.round(target),
    range: { floor: Math.round(floor), bandLow: Math.round(bandLow), bandHigh: Math.round(bandHigh), ceiling: Math.round(ceiling) },
    macros: {
      protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat), fiber: Math.round((14 * target) / 1000),
      basis: bmr.lbmKg ? `${proteinPerLbm} g/kg lean mass` : `${proteinPerKg} g/kg body weight`,
    },
    warnings,
  };
}
