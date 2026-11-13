import { get } from "./api.js";
import { intakeChart, weightChart } from "./charts.js";
import { $, esc, n0, n1 } from "./util.js";

let range = 28;

export async function renderTrends(root) {
  root.innerHTML = `<h1>Trends</h1>
    <div class="seg" id="rng">${[14, 28, 56, 90].map((d) => `<button data-d="${d}" class="${d === range ? "on" : ""}">${d} days</button>`).join("")}</div>
    <div id="tr"><div class="card" style="margin-top:10px"><span class="spin"></span>Loading…</div></div>`;
  $("#rng", root).onclick = (e) => { const d = Number(e.target.dataset.d); if (d) { range = d; renderTrends(root); } };
  try {
    const t = await get(`/api/trends?days=${range}`);
    const logged = t.series.filter((s) => s.intake != null && s.date < t.to); // today is still in progress
    const avg = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : null);
    const inBand = logged.filter((s) => s.intake >= s.floor && s.intake <= s.ceiling).length;
    const proteinHit = logged.filter((s) => s.protein >= s.proteinTarget * 0.9).length;
    const a = t.adaptive;
    $("#tr", root).innerHTML = `
      <h2>Calories vs target</h2>
      <div class="card">${intakeChart(t.series)}
        <p class="tiny muted" style="margin:8px 0 0">The dashed line is your target and the shaded strip is your safe range. Green bars hit the target, amber bars missed it, red bars went outside the safe range. Today stays grey until it's over.</p></div>
      ${!logged.length ? `<p class="empty">Stats start after your first full day of logging.</p>` : `<div class="grid2">
        <div class="stat"><b>${n0(avg(logged, "intake"))}</b><span>average eaten per day</span></div>
        <div class="stat"><b>${n0(avg(logged, "target"))}</b><span>average target</span></div>
        <div class="stat"><b>${inBand}/${logged.length}</b><span>days in your safe range</span></div>
        <div class="stat"><b>${proteinHit}/${logged.length}</b><span>days you got enough protein</span></div>
      </div>`}
      <h2>Weight</h2>
      <div class="card">${weightChart(t.series)}<p class="tiny muted" style="margin:8px 0 0">Dots are daily weigh-ins. The line smooths out water and salt swings, so watch the line.</p></div>
      <h2>Your real burn</h2>
      <div class="card">
        ${a.ready ? `<div class="grid2">
          <div class="stat"><b>${n0(a.observedTdee)}</b><span>kcal a day, measured</span></div>
          <div class="stat"><b>${n0(a.avgFormula)}</b><span>kcal a day, by formula</span></div>
          <div class="stat"><b>×${a.k}</b><span>applied to targets, ${Math.round(a.confidence * 100)}% confident</span></div>
          <div class="stat"><b>${a.slopeKgPerWeek > 0 ? "+" : ""}${n1(a.slopeKgPerWeek)} kg</b><span>trend weight per week</span></div>
        </div><p class="small muted">Based on ${a.loggedDays} logged days and ${a.weighIns} weigh-ins in the last 4 weeks.</p>`
        : `<p class="small" style="margin-top:0">Not measured yet. To start, ${esc(a.reason)}.</p><p class="small muted">Log food on most days and weigh yourself a few mornings a week. After about two weeks, the app compares what you ate with how your weight moved and works out what you actually burn. That's more accurate than any formula or watch.</p>
           <p class="small muted">${a.loggedDays} days logged and ${a.weighIns} weigh-ins so far.</p>`}
      </div>`;
  } catch (e) { $("#tr", root).innerHTML = `<div class="card">${esc(e.message)}</div>`; }
}
