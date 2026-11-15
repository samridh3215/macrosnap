// Tiny dependency-free SVG charts.
const W = 340, H = 170, PAD = { l: 34, r: 8, t: 10, b: 20 };

function axis(min, max, ticks = 4) {
  const step = niceStep((max - min) / ticks);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const vals = []; for (let v = lo; v <= hi + 1e-9; v += step) vals.push(+v.toFixed(6));
  return { lo, hi, vals };
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const fmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${+v.toFixed(1)}`);

/** Daily intake bars against the healthy band (floor→ceiling) and the target line. */
export function intakeChart(series) {
  const vals = series.flatMap((s) => [s.intake ?? 0, s.ceiling, s.target]);
  const { lo, hi, vals: ticks } = axis(0, Math.max(...vals) * 1.05);
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, bw = iw / series.length;
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  let g = ticks.map((t) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--rim-soft)" stroke-width=".6"/><text x="${PAD.l - 4}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join("");
  series.forEach((s, i) => {
    const x = PAD.l + i * bw;
    g += `<rect x="${x}" y="${y(s.ceiling)}" width="${bw}" height="${y(s.floor) - y(s.ceiling)}" fill="var(--leaf)" opacity=".14"/>`;
    if (s.intake != null) {
      const col = i === series.length - 1 ? "var(--rim)" : s.intake < s.floor || s.intake > s.ceiling ? "var(--mirch)" : Math.abs(s.intake - s.target) / s.target <= 0.05 ? "var(--leaf)" : "var(--haldi)";
      g += `<rect x="${x + bw * 0.18}" y="${y(s.intake)}" width="${bw * 0.64}" height="${Math.max(0, y(0) - y(s.intake))}" rx="1.5" fill="${col}"/>`;
    }
  });
  g += `<polyline fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="3 2" points="${series.map((s, i) => `${PAD.l + i * bw + bw / 2},${y(s.target)}`).join(" ")}"/>`;
  g += labels(series, bw);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}

/** Scale weights as dots, smoothed trend as a line. */
export function weightChart(series) {
  const pts = series.filter((s) => s.weight != null || s.trend != null);
  if (!pts.length) return `<p class="empty">Log your weight to see a trend.</p>`;
  const vals = pts.flatMap((s) => [s.weight, s.trend].filter((v) => v != null));
  const { lo, hi, vals: ticks } = axis(Math.min(...vals) - 0.3, Math.max(...vals) + 0.3);
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, bw = iw / series.length;
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const x = (i) => PAD.l + i * bw + bw / 2;
  let g = ticks.map((t) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--rim-soft)" stroke-width=".6"/><text x="${PAD.l - 4}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join("");
  g += `<polyline fill="none" stroke="var(--neel)" stroke-width="2.4" points="${series.map((s, i) => (s.trend != null ? `${x(i)},${y(s.trend)}` : "")).filter(Boolean).join(" ")}"/>`;
  series.forEach((s, i) => { if (s.weight != null) g += `<circle cx="${x(i)}" cy="${y(s.weight)}" r="2.6" fill="var(--ink)" opacity=".55"/>`; });
  g += labels(series, bw);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}

function labels(series, bw) {
  const every = Math.ceil(series.length / 6);
  return series.map((s, i) => (i % every === 0 ? `<text x="${PAD.l + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${s.date.slice(8)}/${s.date.slice(5, 7)}</text>` : "")).join("");
}
