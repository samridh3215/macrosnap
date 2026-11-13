import { describe, expect, it } from "vitest";
import { computeAdaptive } from "../src/energy/adaptive.js";
import { computeBmr, computeTargets, estimateActivity, suggestPreset } from "../src/energy/energy.js";
import { addDays } from "../src/util/date.js";
import { Settings, type Activity } from "../src/types.js";

const me = { weightKg: 75, heightCm: 178, age: 23, sex: "male" as const };

describe("BMR formula selection", () => {
  it("uses Mifflin–St Jeor with full stats", () => {
    const b = computeBmr(me);
    expect(b.formula).toBe("Mifflin–St Jeor");
    expect(b.kcal).toBe(Math.round(10 * 75 + 6.25 * 178 - 5 * 23 + 5)); // 1752.5 → 1753
  });
  it("prefers lean-mass formulas when body fat is known", () => {
    expect(computeBmr({ ...me, bodyFatPct: 15 }).formula).toBe("Katch–McArdle");
    expect(computeBmr({ ...me, bodyFatPct: 15, athlete: true }).formula).toBe("Cunningham");
    expect(computeBmr({ ...me, bodyFatPct: 15 }).candidates).toHaveLength(3);
  });
  it("degrades gracefully and says what it assumed", () => {
    const b = computeBmr({ weightKg: 80 });
    expect(b.formula).toMatch(/Weight-only/);
    expect(b.assumptions.join()).toMatch(/height/);
  });
});

describe("activity estimation", () => {
  const bmr = 1750;
  it("ranks signals: device > power > ACSM > HR > MET", () => {
    expect(estimateActivity({ minutes: 60, sport: "Ride", deviceKcal: 700, kilojoules: 600 }, me, bmr).method).toBe("device");
    expect(estimateActivity({ minutes: 60, sport: "Ride", kilojoules: 600 }, me, bmr)).toMatchObject({ method: "power", gross: 598 });
    expect(estimateActivity({ minutes: 50, sport: "Run", distanceKm: 10 }, me, bmr).method).toBe("acsm");
    expect(estimateActivity({ minutes: 45, sport: "Workout", avgHr: 150 }, me, bmr).method).toBe("hr");
    expect(estimateActivity({ minutes: 45, sport: "Yoga" }, me, bmr).method).toBe("met");
  });
  it("10 km in 50 min ≈ 750–850 kcal gross for 75 kg, net subtracts resting burn", () => {
    const r = estimateActivity({ minutes: 50, sport: "Run", distanceKm: 10 }, me, bmr);
    expect(r.gross).toBeGreaterThan(700);
    expect(r.gross).toBeLessThan(900);
    expect(r.gross - r.net).toBe(Math.round((1750 / 1440) * 50));
  });
  it("suggests presets from training load", () => {
    const a = (net: number): Activity => ({ id: "x", source: "manual", name: "", sport: "Run", minutes: 30, kcalGross: net, kcalNet: net, method: "manual" });
    expect(suggestPreset([])).toBeNull();
    expect(suggestPreset([a(100)])).toBe("recovery");
    expect(suggestPreset([a(300)])).toBe("easy");
    expect(suggestPreset([a(500)])).toBe("normal");
    expect(suggestPreset([a(400), a(500)])).toBe("hard");
  });
});

describe("targets", () => {
  const settings = (goal: "cut" | "maintain" | "bulk") => Settings.parse({ goal: { type: goal, ratePctPerWeek: 0.5 } });
  it("hard days get more calories and carbs, same protein-ish", () => {
    const idle = computeTargets({ profile: me, settings: settings("maintain"), presetId: "idle", activities: [] });
    const hard = computeTargets({ profile: me, settings: settings("maintain"), presetId: "hard", activities: [] });
    expect(hard.target).toBeGreaterThan(idle.target + 800);
    expect(hard.macros.carbs).toBeGreaterThan(idle.macros.carbs * 1.8);
    expect(hard.macros.protein).toBeGreaterThanOrEqual(idle.macros.protein);
  });
  it("cut keeps target inside a sane range and above BMR", () => {
    const t = computeTargets({ profile: me, settings: settings("cut"), presetId: "normal", activities: [] });
    expect(t.goalDelta).toBeLessThan(0);
    expect(t.target).toBeGreaterThanOrEqual(t.range.floor);
    expect(t.range.ceiling).toBe(t.tdee); // on a cut, eating past maintenance undoes the day
    expect(t.range.bandLow).toBeLessThan(t.target);
    expect(t.range.bandHigh).toBeGreaterThan(t.target);
    const kcalFromMacros = t.macros.protein * 4 + t.macros.carbs * 4 + t.macros.fat * 9;
    expect(Math.abs(kcalFromMacros - t.target)).toBeLessThan(15);
  });
  it("logged activities override the preset default, scaled by eat-back", () => {
    const run: Activity = { id: "r", source: "strava", name: "Run", sport: "Run", minutes: 50, kcalGross: 800, kcalNet: 740, method: "device" };
    const t = computeTargets({ profile: me, settings: settings("maintain"), presetId: "normal", activities: [run] });
    expect(t.exercise).toMatchObject({ source: "activities", kcal: Math.round(740 * 0.85) });
  });
  it("applies the adaptive factor", () => {
    const base = computeTargets({ profile: me, settings: settings("maintain"), presetId: "normal", activities: [] });
    const adj = computeTargets({ profile: me, settings: settings("maintain"), presetId: "normal", activities: [], adaptiveK: 1.1 });
    expect(adj.tdee).toBe(Math.round(base.tdeeFormula * 1.1));
  });
});

describe("adaptive TDEE", () => {
  // Simulate 28 days: true TDEE 2800, formula says 2500, eating 2500 → losing ~0.27 kg/week.
  const days = Array.from({ length: 28 }, (_, i) => {
    const date = addDays("2026-10-01", i);
    const trueWeight = 76 - (300 / 7700) * i;
    const noise = [0.4, -0.3, 0.1, -0.5, 0.3, 0, -0.2][i % 7];
    return { date, intake: 2500, weight: i % 2 === 0 ? trueWeight + noise : null, formulaTdee: 2500 };
  });
  it("recovers true expenditure from noisy weights", () => {
    const r = computeAdaptive(days);
    expect(r.ready).toBe(true);
    expect(r.observedTdee!).toBeGreaterThan(2650);
    expect(r.observedTdee!).toBeLessThan(2950);
    expect(r.k).toBeGreaterThan(1.03);
  });
  it("waits for enough data", () => {
    const r = computeAdaptive(days.slice(0, 6));
    expect(r.ready).toBe(false);
    expect(r.k).toBe(1);
    expect(r.reason).toMatch(/more days/);
  });
});
