// Tiny dependency-free charts: HTML bars for calories, SVG for the weight line.
/** Group a long series into weekly averages so 90 days stays readable. */
export function weekly(series) {
  const out = [];
  for (let i = 0; i < series.length; i += 7) {
    const g = series.slice(i, i + 7), logged = g.filter((s) => s.intake != null);
    const avg = (k) => g.reduce((a, s) => a + (s[k] ?? 0), 0) / g.length;
    out.push({ date: g[0].date, intake: logged.length ? logged.reduce((a, s) => a + s.intake, 0) / logged.length : null, target: avg("target"), floor: avg("floor"), ceiling: avg("ceiling"), today: g.some((s) => s.today) });
  }
  return out;
}

/** Daily intake bars. In range is the bright accent, outside it the dim one; the target is a thin line and maintenance a dashed one. */
export function intakeChart(series, { isWeekly = false, ended }) {
  const bars = isWeekly ? weekly(series) : series;
  const H = 168;
  const max = Math.max(...bars.flatMap((s) => [s.intake ?? 0, s.ceiling, s.target])) * 1.08 || 1;
  const y = (v) => Math.round((v / max) * H);
  const last = bars.length - 1;
  const tgt = bars.reduce((a, s) => a + s.target, 0) / bars.length, top = bars.reduce((a, s) => a + s.ceiling, 0) / bars.length;
  const f = (n) => Math.round(n).toLocaleString("en-IN");
  const cols = bars.map((s, i) => {
    const inProgress = i === last && !isWeekly && s.date >= ended;
    const ok = s.intake != null && s.intake >= s.floor && s.intake <= s.ceiling;
    const bg = s.intake == null ? "transparent" : inProgress ? "var(--rim)" : ok ? "var(--haldi)" : "var(--accent-2)";
    const label = s.intake == null ? "" : `${f(s.intake)} kcal`;
    return `<div class="bar-col" title="${s.date.slice(8)}/${s.date.slice(5, 7)} ${label}" role="img" aria-label="${s.date} ${label || "nothing logged"}"><i style="height:${s.intake == null ? 0 : y(s.intake)}px;background:${bg}"></i></div>`;
  }).join("");
  const every = Math.ceil(bars.length / 6);
  const axis = bars.map((s, i) => (i % every === 0 ? `<span style="left:${((i + 0.5) / bars.length) * 100}%">${s.date.slice(8)}/${s.date.slice(5, 7)}</span>` : "")).join("");
  return `<div class="bars" style="height:${H}px">
      <div class="ref ref-top" style="bottom:${y(top)}px"></div><span class="ref-l ref-l-top" style="bottom:${y(top) + 2}px">Maint. ${f(top)}</span>
      <div class="ref ref-tgt" style="bottom:${y(tgt)}px"></div><span class="ref-l ref-l-tgt" style="bottom:${y(tgt) + 2}px">Target ${f(tgt)}</span>
      <div class="bar-cols" style="gap:${bars.length > 20 ? 2 : 5}px">${cols}</div>
    </div>
    <div class="bar-axis" aria-hidden="true">${axis}</div>`;
}

/** Scale weights as grey dots, the smoothed trend as the one accent line. */
export function weightChart(series) {
  const pts = series.filter((s) => s.weight != null || s.trend != null);
  if (!pts.length) return `<p class="empty sm">Log your weight to see a trend.</p>`;
  // Start the chart a few days before the first weigh-in (at least a week wide) so a new user's points aren't squeezed into one corner.
  const first = series.findIndex((s) => s.weight != null || s.trend != null);
  series = series.slice(Math.max(0, Math.min(first - 2, series.length - 7)));
  const W = 322, H = 140, N = series.length;
  const vals = pts.flatMap((s) => [s.weight, s.trend].filter((v) => v != null));
  const lo = Math.min(...vals) - 0.2, hi = Math.max(...vals) + 0.2;
  const x = (i) => (N === 1 ? W / 2 : (i / (N - 1)) * (W - 8) + 4);
  const y = (w) => (1 - (w - lo) / (hi - lo || 1)) * (H - 12) + 6;
  const line = series.map((s, i) => (s.trend != null ? `${x(i).toFixed(1)},${y(s.trend).toFixed(1)}` : "")).filter(Boolean).join(" ");
  const wline = series.map((s, i) => (s.weight != null ? `${x(i).toFixed(1)},${y(s.weight).toFixed(1)}` : "")).filter(Boolean).join(" ");
  const dots = series.map((s, i) => (s.weight != null ? `<circle cx="${x(i).toFixed(1)}" cy="${y(s.weight).toFixed(1)}" r="2.6" fill="var(--ink-faint)"/>` : "")).join("");
  return `<svg class="wchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend"><line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="var(--raise)"/><polyline points="${wline}" fill="none" stroke="var(--ink-faint)" stroke-width="1.25" stroke-linejoin="round" opacity=".6"/>${dots}<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
