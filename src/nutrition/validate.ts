import type { Ingredient, Macros } from "../types.js";

/**
 * Deterministic sanity checks on LLM-derived nutrition. These catch "made up" numbers:
 * energy that doesn't match the macros, more than 100 g of nutrients in 100 g of food,
 * and recipes whose ingredients don't add up to the stated totals.
 */
export function validateNutrition(p: Macros, ingredients: Ingredient[] = []): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const atwater = 4 * p.protein + 4 * p.carbs + 9 * p.fat + 2 * p.fiber;
  if (Math.abs(p.kcal - atwater) > Math.max(20, 0.12 * p.kcal)) {
    issues.push(`kcal ${r(p.kcal)} doesn't match macros (4P+4C+9F+2Fib = ${r(atwater)})`);
  }
  const mass = p.protein + p.carbs + p.fat + p.fiber;
  if (mass > 102) issues.push(`macros total ${r(mass)} g per 100 g — impossible`);
  if (p.kcal > 900) issues.push(`${r(p.kcal)} kcal/100 g exceeds pure fat`);
  if (p.kcal <= 0 && mass > 1) issues.push("zero kcal with non-zero macros");

  if (ingredients.length) {
    const g = ingredients.reduce((s, i) => s + i.grams, 0);
    // Raw ingredient weights can exceed 100 g when water is lost (tandoor), or fall short when water is absorbed.
    if (g < 40 || g > 180) issues.push(`ingredients total ${r(g)} g per 100 g of dish — implausible`);
    const k = ingredients.reduce((s, i) => s + i.kcal, 0);
    if (Math.abs(k - p.kcal) > Math.max(25, 0.15 * p.kcal)) issues.push(`ingredient kcal sum ${r(k)} ≠ total ${r(p.kcal)}`);
  }
  return { ok: issues.length === 0, issues };
}

/** Scale per-100 g values to a portion. */
export function scale(p: Macros, grams: number): Macros {
  const f = grams / 100;
  return {
    kcal: Math.round(p.kcal * f),
    protein: r1(p.protein * f),
    carbs: r1(p.carbs * f),
    fat: r1(p.fat * f),
    fiber: r1(p.fiber * f),
  };
}

export function sumMacros(list: Macros[]): Macros {
  const t = list.reduce((a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat, fiber: a.fiber + m.fiber }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat), fiber: r1(t.fiber) };
}

const r = (n: number) => Math.round(n);
export const r1 = (n: number) => Math.round(n * 10) / 10;
