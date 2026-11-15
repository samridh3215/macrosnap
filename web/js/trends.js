import { get } from "./api.js";
import { intakeChart, weightChart } from "./charts.js";
import { $, enter, esc, n0, n1 } from "./util.js";

let range = 28;

export async function renderTrends(root) {
  root.innerHTML = `<h1>Trends</h1>
    <div class="seg" id="rng">${[14, 28, 56, 90].map((d) => `<button data-d="${d}" class="${d === range ? "on" : ""}">${d} days</button>`).join("")}</div>
    <div id="tr"><p class="empty"><span class="spin"></span>Loading…</p></div>`;
  $("#rng", root).onclick = (e) => { const d = Number(e.target.dataset.d); if (d) { range = d; renderTrends(root); } };
  try {
    const t = await get(`/api/trends?days=${range}`);
    const logged = t.series.filter((s) => s.intake != null && s.date < t.to); // today is still in progress
    const avg = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : null);
    const inBand = logged.filter((s) => s.intake >= s.floor && s.intake <= s.ceiling).length;
    const proteinHit = logged.filter((s) => s.protein >= s.proteinTarget * 0.9).length;
    const a = t.adaptive;
    $("#tr", root).innerHTML = `
      ${!logged.length ? `<p class="empty">Stats start after your first full day of logging.</p>` : `<div class="stats" style="margin-top:14px">
        <div class="stat"><b>${n0(avg(logged, "intake"))}</b><span>avg eaten per day</span></div>
        <div class="stat"><b>${n0(avg(logged, "target"))}</b><span>avg target</span></div>
        <div class="stat"><b>${inBand}<small class="muted" style="font:500 15px var(--body)">/${logged.length}</small></b><span>days in your safe range</span></div>
        <div class="stat"><b>${proteinHit}<small class="muted" style="font:500 15px var(--body)">/${logged.length}</small></b><span>days with enough protein</span></div>
      </div>`}
      <h2>Calories vs target</h2>
      <div class="card">${intakeChart(t.series)}
        <p class="chart-note">Dashed line is your target, the shaded strip your safe range. Green hit the target, amber missed it, red left the safe range. Today stays grey until it's over.</p></div>
      <h2>Weight</h2>
      <div class="card">${weightChart(t.series)}<p class="chart-note">Dots are weigh-ins. The line smooths out water and salt swings, so watch the line.</p></div>
      <h2>Your real burn</h2>
      <div class="card">
        ${a.ready ? `<div class="grid2">
          <div class="stat" style="padding:0;background:none"><b>${n0(a.observedTdee)}</b><span>kcal a day, measured</span></div>
          <div class="stat" style="padding:0;background:none"><b>${n0(a.avgFormula)}</b><span>kcal a day, by formula</span></div>
          <div class="stat" style="padding:12px 0 0;background:none"><b>×${a.k}</b><span>applied to targets, ${Math.round(a.confidence * 100)}% confident</span></div>
          <div class="stat" style="padding:12px 0 0;background:none"><b>${a.slopeKgPerWeek > 0 ? "+" : ""}${n1(a.slopeKgPerWeek)} kg</b><span>trend weight per week</span></div>
        </div><p class="chart-note">Based on ${a.loggedDays} logged days and ${a.weighIns} weigh-ins in the last 4 weeks.</p>`
        : `<p class="small" style="margin-top:0">Not measured yet. To start, ${esc(a.reason)}.</p><p class="small muted">Log food on most days and weigh yourself a few mornings a week. After about two weeks, the app compares what you ate with how your weight moved and works out what you actually burn. That's more accurate than any formula or watch.</p>
           <p class="small muted" style="margin-bottom:0">${a.loggedDays} days logged and ${a.weighIns} weigh-ins so far.</p>`}
      </div>`;
    enter($("#tr", root));
  } catch (e) { $("#tr", root).innerHTML = `<div class="card">${esc(e.message)}</div>`; }
}
