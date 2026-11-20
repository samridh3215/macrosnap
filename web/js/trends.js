import { get } from "./api.js";
import { intakeChart, weightChart } from "./charts.js";
import { $, enter, esc, n0, n1, weekAverages } from "./util.js";

let range = 30;
const RANGES = [14, 30, 90];

export async function renderTrends(root) {
  if (!RANGES.includes(range)) range = 30;
  root.innerHTML = `<header class="page-head"><h1>Trends</h1>
    <div class="seg compact" id="rng" role="group" aria-label="Range">${RANGES.map((d) => `<button data-d="${d}" aria-pressed="${d === range}" class="${d === range ? "on" : ""}">${d} d</button>`).join("")}</div></header>
    <div id="tr"><div class="sk sk-hero"></div><div class="sk sk-row"></div><div class="sk sk-row"></div></div>`;
  $("#rng", root).onclick = (e) => { const d = Number(e.target.dataset.d); if (d) { range = d; renderTrends(root); } };
  try {
    const t = await get(`/api/trends?days=${range}`);
    const logged = t.series.filter((s) => s.intake != null && s.date < t.to); // today is still in progress
    const avg = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : null);
    const inBand = logged.filter((s) => s.intake >= s.floor && s.intake <= s.ceiling).length;
    const proteinHit = logged.filter((s) => s.protein >= s.proteinTarget * 0.9).length;
    const a = t.adaptive;
    const trendPts = t.series.filter((s) => s.trend != null);
    const delta = trendPts.length > 1 ? trendPts[trendPts.length - 1].trend - trendPts[0].trend : null;
    const proteinAvg = avg(logged, "protein"), proteinGoal = avg(logged, "proteinTarget");
    const few = logged.length < 3;
    const wk = weekAverages(t.series, t.to);
    const wkDelta = wk.cur != null && wk.prev != null ? wk.cur - wk.prev : null;
    const tile = (label, value, note) => `<div class="stat-tile"><span class="t-l">${label}</span><b class="num">${value}</b><span class="t-n">${note}</span></div>`;
    $("#tr", root).innerHTML = `
      <section class="panel" aria-label="Calories">
        <div class="sec-h"><h2>Calories</h2><span class="h2-n">${range === 90 ? "Weekly averages" : "Daily totals"}</span></div>
        ${intakeChart(t.series, { isWeekly: range === 90, ended: t.to })}
        <div class="legend"><span><i style="background:var(--haldi)"></i>In range</span><span><i style="background:var(--accent-2)"></i>Outside range</span></div>
      </section>
      <section class="tiles" aria-label="Summary">
        ${tile("Average intake", few ? "—" : n0(avg(logged, "intake")), few ? "log 3 days to see this" : "kcal a day")}
        ${tile("Days in range", few ? "—" : `${inBand} / ${logged.length}`, few ? "log 3 days to see this" : "between min and maintenance")}
        ${tile("Average protein", few ? "—" : `${n0(proteinAvg)} g`, few ? "log 3 days to see this" : `target ${n0(proteinGoal)} g · ${proteinHit} / ${logged.length} days on target`)}
        ${tile("Days logged", `${logged.length} / ${t.series.length - 1}`, logged.length >= t.series.length - 1 ? "no gaps" : "full days only")}
      </section>
      <section class="panel" aria-label="Weight">
        <div class="sec-h"><div><h2>Weight</h2><span class="h2-s num">${trendPts.length ? `Trend ${n1(trendPts[trendPts.length - 1].trend)} kg${delta != null ? ` · ${delta >= 0 ? "+" : "−"}${n1(Math.abs(delta))} kg over ${range} days` : ""}` : "No weigh-ins yet"}</span></div><a class="btn chip-btn" href="#/weighins">Weigh-ins</a></div>
        <div class="tiles wk-tiles">
          <div class="stat-tile"><span class="t-l">This week's average</span><b class="num">${wk.cur != null ? `${n1(wk.cur)} kg` : "—"}</b><span class="t-n">${wk.curN ? `${wk.curN} weigh-in${wk.curN === 1 ? "" : "s"}, last 7 days` : "no weigh-ins in 7 days"}</span></div>
          <div class="stat-tile"><span class="t-l">Last week's average</span><b class="num">${wk.prev != null ? `${n1(wk.prev)} kg` : "—"}</b><span class="t-n">${wkDelta != null ? `${wkDelta >= 0 ? "+" : "−"}${n1(Math.abs(wkDelta))} kg vs this week` : "the 7 days before"}</span></div>
        </div>
        ${weightChart(t.series)}
        <div class="legend"><span><i class="dot" style="background:var(--ink-faint)"></i>Daily weigh-in</span><span><i class="ln" style="background:var(--accent)"></i>Smoothed trend</span></div>
      </section>
      <section class="panel" aria-label="Real burn">
        <div class="sec-h"><div><h2>Real burn</h2><span class="h2-s">Learned from your intake and weight trend</span></div><b class="big num">${a.ready ? n0(a.observedTdee) : "—"}</b></div>
        ${a.ready ? `<p class="body-s">Based on ${a.loggedDays} logged days and ${a.weighIns} weigh-ins in the last 4 weeks. Your trend moves ${a.slopeKgPerWeek > 0 ? "+" : ""}${n1(a.slopeKgPerWeek)} kg a week, and targets are scaled ×${a.k} (${Math.round(a.confidence * 100)}% confident). The formula alone would say ${n0(a.avgFormula)} kcal a day.</p>
          <div class="kv"><div><span>Measured</span><b class="num">${n0(a.observedTdee)} kcal</b></div><div><span>By formula</span><b class="num">${n0(a.avgFormula)} kcal</b></div><div><span>Applied to targets</span><b class="num">×${a.k}</b></div><div><span>Trend weight per week</span><b class="num">${a.slopeKgPerWeek > 0 ? "+" : ""}${n1(a.slopeKgPerWeek)} kg</b></div></div>`
        : `<p class="body-s">Not measured yet. To start, ${esc(a.reason)}.</p><p class="body-s muted">Log food on most days and weigh yourself a few mornings a week. After about two weeks, the app compares what you ate with how your weight moved and works out what you actually burn. That's more accurate than any formula or watch.</p>
           <p class="body-s muted">${a.loggedDays} days logged and ${a.weighIns} weigh-ins so far.</p>`}
      </section>`;
    enter($("#tr", root));
  } catch (e) { $("#tr", root).innerHTML = `<div class="card">${esc(e.message)}</div>`; }
}
