/**
 * Adaptive TDEE — learn your real expenditure from what you ate and what the scale did.
 *
 *   observed TDEE = average logged intake − (trend weight change × 7700 kcal/kg) / days
 *
 * Daily weight is noisy (water, glycogen, salt), so we interpolate gaps, smooth with an EWMA
 * (α = 0.1, the classic "Hacker's Diet" trend) and fit a least-squares slope to the trend.
 * Rather than replacing the formula, we learn a correction factor k = observed / formula, so
 * day-to-day differences (hard vs idle day) are kept while the overall level is calibrated.
 * k is confidence-weighted and clamped so a bad week can't wreck the targets.
 */
export interface AdaptiveDay { date: string; intake: number | null; weight: number | null; formulaTdee: number }

export interface AdaptiveResult {
  ready: boolean;
  k: number; // factor to apply (1 when not ready)
  kRaw: number | null;
  observedTdee: number | null;
  avgIntake: number | null;
  avgFormula: number | null;
  slopeKgPerWeek: number | null;
  loggedDays: number;
  weighIns: number;
  confidence: number; // 0..1
  trend: Array<{ date: string; weight: number | null; trend: number | null }>;
  reason: string;
}

const KCAL_PER_KG = 7700;
const ALPHA = 0.1;

export function computeAdaptive(days: AdaptiveDay[], opts: { minLogged?: number; minWeighIns?: number } = {}): AdaptiveResult {
  const minLogged = opts.minLogged ?? 10;
  const minWeighIns = opts.minWeighIns ?? 6;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  // A day counts as "logged" if intake looks complete (≥ 40% of formula expenditure).
  const logged = sorted.filter((d) => d.intake != null && d.intake >= 0.4 * d.formulaTdee);
  const weighIns = sorted.filter((d) => d.weight != null).length;

  // Interpolate weights across gaps, then EWMA.
  const wIdx = sorted.map((d, i) => (d.weight != null ? i : -1)).filter((i) => i >= 0);
  const interp: Array<number | null> = sorted.map(() => null);
  if (wIdx.length) {
    for (let i = 0; i < sorted.length; i++) {
      if (i < wIdx[0] || i > wIdx[wIdx.length - 1]) continue;
      const nextI = wIdx.find((j) => j >= i)!;
      const prevI = [...wIdx].reverse().find((j) => j <= i)!;
      const a = sorted[prevI].weight!, b = sorted[nextI].weight!;
      interp[i] = nextI === prevI ? a : a + ((b - a) * (i - prevI)) / (nextI - prevI);
    }
  }
  let ema: number | null = null;
  const trend = sorted.map((d, i) => {
    const v = interp[i];
    if (v != null) ema = ema == null ? v : ema + ALPHA * (v - ema);
    return { date: d.date, weight: d.weight, trend: v != null && ema != null ? Math.round(ema * 100) / 100 : null };
  });

  const base: AdaptiveResult = {
    ready: false, k: 1, kRaw: null, observedTdee: null, avgIntake: null, avgFormula: null, slopeKgPerWeek: null,
    loggedDays: logged.length, weighIns, confidence: 0, trend, reason: "",
  };
  if (logged.length < minLogged) return { ...base, reason: `log food on ${minLogged - logged.length} more days` };
  if (weighIns < minWeighIns) return { ...base, reason: `${minWeighIns - weighIns} more weigh-ins needed` };

  const pts = trend.map((t, i) => [i, t.trend] as const).filter((p): p is readonly [number, number] => p[1] != null);
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / (pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0) || 1); // kg/day

  const avgIntake = logged.reduce((s, d) => s + d.intake!, 0) / logged.length;
  const avgFormula = logged.reduce((s, d) => s + d.formulaTdee, 0) / logged.length;
  const observed = avgIntake - slope * KCAL_PER_KG;
  const kRaw = observed / avgFormula;
  const clamped = Math.min(1.25, Math.max(0.75, kRaw));
  const confidence = Math.min(1, logged.length / 21) * Math.min(1, weighIns / 12);
  const k = 1 + confidence * (clamped - 1);

  return {
    ...base,
    ready: true,
    k: Math.round(k * 1000) / 1000,
    kRaw: Math.round(kRaw * 1000) / 1000,
    observedTdee: Math.round(observed),
    avgIntake: Math.round(avgIntake),
    avgFormula: Math.round(avgFormula),
    slopeKgPerWeek: Math.round(slope * 7 * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    reason: kRaw !== clamped ? "correction clamped to ±25% — check logging completeness" : "calibrated from your intake and weight trend",
  };
}
