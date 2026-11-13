import { del, get, post, put } from "./api.js";
import { openReview } from "./review.js";
import { $, addDays, closeSheet, esc, n0, n1, openSheet, prettyDate, toast, today } from "./util.js";

export const dayState = { date: today(), data: null };
let rootEl = null;
let poured = false; // the katori pour plays once per session, not on every redraw

const METHOD = { device: "watch calories", power: "power meter", acsm: "pace model", hr: "heart rate", met: "activity estimate", manual: "entered" };
const ICON = {
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.3" r="3.4"/></svg>`,
  talk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 19l1-4L16 5l3 3L9 18z"/></svg>`,
  plate: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/></svg>`,
};

export async function renderToday(root) {
  rootEl = root;
  root.innerHTML = `${header()}<p class="empty"><span class="spin"></span>Setting the table…</p>`;
  bindHeader(root);
  try {
    dayState.data = await get(`/api/day/${dayState.date}`);
    draw();
  } catch (e) {
    root.innerHTML = `${header()}<div class="card"><h3>Couldn't load this day</h3><p class="muted">${esc(e.message)}</p>
      ${e.status === 401 ? `<a class="btn primary sm" href="#/settings">Add your app token</a>` : `<button class="btn sm" id="retry">Try again</button>`}</div>`;
    bindHeader(root);
    $("#retry", root)?.addEventListener("click", () => renderToday(root));
  }
}

function header() {
  return `<div class="daybar">
    <div class="title">${prettyDate(dayState.date)}<div class="tiny">${new Date(`${dayState.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div></div>
    <button class="icon-btn" id="prevDay" aria-label="Previous day">‹</button>
    <button class="icon-btn" id="nextDay" aria-label="Next day" ${dayState.date >= today() ? "disabled" : ""}>›</button>
  </div>`;
}
function bindHeader(root) {
  $("#prevDay", root).onclick = () => { dayState.date = addDays(dayState.date, -1); renderToday(root); };
  $("#nextDay", root).onclick = () => { if (dayState.date < today()) { dayState.date = addDays(dayState.date, 1); renderToday(root); } };
}

/* ---------- the thali: rim = calories, katoris = macros ---------- */
function thali(d) {
  const t = d.targets, r = t.range, eaten = d.totals.kcal;
  const C = 180, R = 152, L = 2 * Math.PI * R;
  const frac = Math.min(eaten / r.ceiling, 1);
  const status = zone(eaten, r, dayState.date >= today()).cls;
  const arcColor = status === "band" ? "var(--leaf)" : status === "over" || status === "under" ? "var(--mirch)" : "var(--ink)";
  const at = (v) => (Math.min(v, r.ceiling) / r.ceiling) * L;
  const left = Math.round(t.target - eaten);
  const big = left >= 0 ? n0(left) : `+${n0(-left)}`;
  const sub = left >= 0 ? `left of ${n0(t.target)} kcal` : `over your ${n0(t.target)} target`;
  // floor tick position on the rim
  const fa = (r.floor / r.ceiling) * 2 * Math.PI - Math.PI / 2;
  const fx1 = C + (R - 9) * Math.cos(fa), fy1 = C + (R - 9) * Math.sin(fa), fx2 = C + (R + 9) * Math.cos(fa), fy2 = C + (R + 9) * Math.sin(fa);

  const katori = (i, cx, label, eatenG, goalG, color) => {
    const kr = 30, inner = 25, f = Math.min(eatenG / (goalG || 1), 1);
    const h = 2 * inner * f;
    return `<g>
      <circle cx="${cx}" cy="206" r="${kr}" fill="#eef1f3" stroke="var(--rim)" stroke-width="1.5"/>
      <clipPath id="kc${i}"><circle cx="${cx}" cy="206" r="${inner}"/></clipPath>
      <circle cx="${cx}" cy="206" r="${inner}" fill="#e2e7ea"/>
      <g clip-path="url(#kc${i})"><rect class="${poured ? "" : `katori-fill k${i}`}" x="${cx - inner}" y="${206 + inner - h}" width="${inner * 2}" height="${h}" fill="${color}"/></g>
      <circle cx="${cx}" cy="206" r="${inner}" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.5"/>
      <text class="kv" x="${cx}" y="255" text-anchor="middle">${n0(eatenG)}<tspan class="kl" dx="1">/${n0(goalG)}g</tspan></text>
      <text class="kl" x="${cx}" y="271" text-anchor="middle">${label}</text>
    </g>`;
  };

  return `<svg class="thali" viewBox="0 0 360 360" role="img" aria-label="${n0(eaten)} of ${n0(t.target)} kcal eaten. Protein ${n0(d.totals.protein)} of ${t.macros.protein} g, carbs ${n0(d.totals.carbs)} of ${t.macros.carbs} g, fat ${n0(d.totals.fat)} of ${t.macros.fat} g.">
    <defs>
      <radialGradient id="steelG" cx="42%" cy="36%" r="75%"><stop offset="0" stop-color="#fbfcfc"/><stop offset=".62" stop-color="#eef1f3"/><stop offset="1" stop-color="#d9dfe3"/></radialGradient>
      <radialGradient id="wellG" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="#f7f9fa"/><stop offset="1" stop-color="#e7ecef"/></radialGradient>
    </defs>
    <circle cx="${C}" cy="${C + 5}" r="168" fill="rgba(24,34,46,.07)"/>
    <circle cx="${C}" cy="${C}" r="168" fill="url(#steelG)" stroke="var(--rim)"/>
    <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#d4dbe0" stroke-width="13"/>
    <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--leaf)" stroke-opacity=".28" stroke-width="13"
      stroke-dasharray="0 ${at(r.bandLow)} ${at(r.bandHigh) - at(r.bandLow)} ${L}" transform="rotate(-90 ${C} ${C})"/>
    <line x1="${fx1}" y1="${fy1}" x2="${fx2}" y2="${fy2}" stroke="var(--ink-soft)" stroke-width="2"/>
    ${eaten > 0 ? `<circle class="arc" cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${arcColor}" stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${frac * L} ${L}" transform="rotate(-90 ${C} ${C})"/>` : ""}
    <circle cx="${C}" cy="${C}" r="134" fill="url(#wellG)" stroke="#cfd6db" stroke-width="1.2"/>
    <text class="big" x="${C}" y="124" text-anchor="middle">${big}</text>
    <text class="sub" x="${C}" y="158" text-anchor="middle">${sub}</text>
    ${katori(1, C - 74, "protein", d.totals.protein, t.macros.protein, "var(--neel)")}
    ${katori(2, C, "carbs", d.totals.carbs, t.macros.carbs, "var(--haldi)")}
    ${katori(3, C + 74, "fat", d.totals.fat, t.macros.fat, "var(--kokum)")}
  </svg>`;
}

function zone(eaten, r, inProgress) {
  if (eaten < r.floor && inProgress) return { cls: "low", text: `Eat ${n0(r.bandLow - eaten)}–${n0(r.bandHigh - eaten)} more today.` };
  if (eaten < r.floor) return { cls: "under", text: `This day ended ${n0(r.floor - eaten)} kcal under your safe minimum.` };
  if (eaten < r.bandLow) return { cls: "low", text: `Eat ${n0(r.bandLow - eaten)}–${n0(r.bandHigh - eaten)} more ${inProgress ? "today" : "to have hit your range"}.` };
  if (eaten <= r.bandHigh) return { cls: "band", text: "You're in your range for the day." };
  if (eaten <= r.ceiling) return { cls: "high", text: `A little over target. ${n0(r.ceiling - eaten)} kcal before your limit.` };
  return { cls: "over", text: `${n0(eaten - r.ceiling)} kcal past today's limit.` };
}

function rangeLine(d) {
  const r = d.targets.range, eaten = d.totals.kcal;
  const max = Math.max(r.ceiling * 1.12, eaten * 1.04);
  const p = (v) => `${(Math.min(v, max) / max) * 100}%`;
  return `<div class="rangeline" aria-hidden="true">
    <div class="track"></div>
    <div class="safe" style="left:${p(r.floor)};width:calc(${p(r.ceiling)} - ${p(r.floor)})"></div>
    <div class="band" style="left:${p(r.bandLow)};width:calc(${p(r.bandHigh)} - ${p(r.bandLow)})"></div>
    <div class="you" style="left:${p(eaten)}"></div>
    <span class="tick" style="left:${p(r.floor)}">min ${n0(r.floor)}</span>
    <span class="tick" style="left:${p(r.ceiling)}">limit ${n0(r.ceiling)}</span>
  </div>`;
}

function draw() {
  const d = dayState.data, t = d.targets, r = t.range, eaten = d.totals.kcal;
  const z = zone(eaten, r, dayState.date >= today());

  const presetChips = d.presets.map((p) => `<button class="chip ${p.id === d.presetId ? "on" : ""} ${p.id === d.suggested ? "sugg" : ""}" data-preset="${p.id}" title="${esc(p.blurb)}">${esc(p.label)}</button>`).join("");
  const presetNote = d.presetSource === "manual" ? `You picked ${esc(t.preset.label.toLowerCase())}. Tap it again to let your activities decide.`
    : d.presetSource === "activities" ? `Picked from today's activities.` : `${esc(t.preset.blurb)}. Tap a day type if today is different.`;

  const calc = [
    [`Resting burn (${esc(t.bmr.formula)})`, n0(t.bmr.kcal)],
    [`With daily movement, ${esc(t.preset.label.toLowerCase())} day ×${t.preset.neat}`, n0(t.neatKcal)],
    [t.exercise.source === "activities" ? `Exercise, ${Math.round(t.exercise.eatBack * 100)}% of logged` : "Exercise, day-type default", `+${n0(t.exercise.kcal)}`],
    ...(t.adaptive.applied ? [[`Calibrated to your weight trend ×${t.adaptive.k}`, n0(t.tdee)]] : [["Total burn", n0(t.tdee)]]),
    ...(t.goalDelta ? [[d.goal.type === "cut" ? `Fat-loss deficit (${d.goal.ratePctPerWeek}% a week)` : `Muscle-gain surplus (${d.goal.ratePctPerWeek}% a week)`, `${t.goalDelta > 0 ? "+" : "−"}${n0(Math.abs(t.goalDelta))}`]] : []),
    ["Today's target", n0(t.target)],
  ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");

  const acts = d.activities.map((a) => `<li class="li">
      <div class="grow"><div class="name">${esc(a.name)}</div><div class="sub">${esc(a.sport)}, ${a.minutes} min${a.avgHr ? `, ${a.avgHr} bpm` : ""}. From ${METHOD[a.method] || a.method}${a.source === "strava" ? " via Strava" : ""}.</div></div>
      <div class="kcal">+${n0(a.kcalNet)}<small>kcal</small></div>
      <button class="btn xs ghost" data-del-act="${a.id}" aria-label="Remove ${esc(a.name)}">✕</button></li>`).join("");

  const meals = d.meals.map((m) => `<li class="li tap" data-meal="${m.id}">
      ${m.thumb ? `<img class="thumb" src="${m.thumb}" alt="">` : `<div class="thumb">${ICON.plate}</div>`}
      <div class="grow"><div class="name">${esc(m.name)}</div>
        <div class="sub">${esc(m.mealType)} &nbsp; <span class="m-p">${n0(m.totals.protein)}p</span> <span class="m-c">${n0(m.totals.carbs)}c</span> <span class="m-f">${n0(m.totals.fat)}f</span></div></div>
      <div class="kcal">${n0(m.totals.kcal)}<small>kcal</small></div></li>`).join("");

  const ad = d.adaptive;
  rootEl.innerHTML = `${header()}
    <div class="chips" id="presets" role="radiogroup" aria-label="Day type">${presetChips}</div>
    <p class="preset-note">${presetNote}</p>

    <div class="thali-wrap">${thali(d)}</div>
    <p class="fiberline">Fiber ${n0(d.totals.fiber)} of ${t.macros.fiber} g</p>

    <p class="verdict ${z.cls}">${z.text}</p>
    <p class="verdict-sub">Your range today is ${n0(r.bandLow)}–${n0(r.bandHigh)} kcal. Don't finish under ${n0(r.floor)} or past ${n0(r.ceiling)}.</p>
    ${rangeLine(d)}
    <details><summary>How today's target is worked out</summary><table class="calc">${calc}</table>
      <p class="tiny muted">Protein is set at ${esc(t.macros.basis)}. Fat follows the day type and carbs fill the rest, so hard days get more carbs.${t.warnings.length ? ` ${t.warnings.map(esc).join(". ")}.` : ""}</p></details>

    <h2>Meals</h2>
    ${meals ? `<ul class="list">${meals}</ul>` : `<p class="empty">Nothing logged yet. Share a photo of your plate from the gallery, or use the buttons below.</p>`}

    <h2>Training</h2>
    ${acts ? `<ul class="list">${acts}</ul>` : `<p class="empty">No training logged. Until you add some, a ${esc(t.preset.label.toLowerCase())} day counts as +${n0(t.preset.defaultExerciseKcal)} kcal.</p>`}
    <div class="row wrap" style="margin-top:10px">
      ${d.strava.enabled ? (d.strava.connected ? `<button class="btn sm" id="syncStrava">Sync Strava</button>` : `<a class="btn sm" href="#/settings">Connect Strava</a>`) : ""}
      <button class="btn sm" id="addAct">Add training</button>
      ${d.strava.syncedAt ? `<span class="tiny muted">Synced at ${new Date(d.strava.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>` : ""}
    </div>

    <h2>Weight</h2>
    <div class="row"><input id="wKg" type="number" inputmode="decimal" step="0.1" placeholder="Morning weight in kg" value="${d.weight.today ?? ""}"><button class="btn sm" id="wSave">Save weight</button></div>
    <p class="small muted" style="margin:10px 2px 0">${d.weight.trend ? `Your trend weight is ${n1(d.weight.trend)} kg. ` : ""}${ad.ready
      ? `Your real burn is about <b>${n0(ad.observedTdee)} kcal</b> a day, so targets are scaled ×${ad.k}.`
      : `Targets use formulas for now. To calibrate them to your body, ${esc(ad.reason)}.`}</p>
    ${d.warnings?.length ? `<p class="tiny muted">${d.warnings.map(esc).join(". ")}</p>` : ""}

    <div class="actions"><div class="dock">
      <button class="snap" id="aPhoto">${ICON.camera}Photo</button>
      <button id="aDescribe">${ICON.talk}Describe</button>
      <button id="aManual">${ICON.pen}Manual</button>
    </div></div>`;
  poured = true;

  bindHeader(rootEl);
  const reload = () => renderToday(rootEl);

  $("#presets", rootEl).onclick = async (e) => {
    const id = e.target.dataset?.preset; if (!id) return;
    const next = id === d.presetId && d.presetSource === "manual" ? null : id;
    dayState.data = await put(`/api/day/${dayState.date}`, { preset: next }); draw();
  };
  $("#syncStrava", rootEl)?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Syncing…";
    try { dayState.data = await post("/api/strava/sync", { date: dayState.date }); draw(); toast("Strava synced"); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Sync Strava"; }
  });
  $("#addAct", rootEl).onclick = () => activityDialog();
  rootEl.querySelectorAll("[data-del-act]").forEach((b) => b.onclick = async () => {
    dayState.data = await del(`/api/day/${dayState.date}/activities/${b.dataset.delAct}`); draw();
  });
  $("#wSave", rootEl).onclick = async () => {
    const kg = Number($("#wKg", rootEl).value);
    if (!kg) return toast("Enter your weight in kg");
    await put(`/api/weights/${dayState.date}`, { kg }); toast("Weight saved"); reload();
  };
  rootEl.querySelectorAll("[data-meal]").forEach((li) => li.onclick = () => {
    const meal = d.meals.find((m) => m.id === li.dataset.meal);
    openReview({ meal, date: dayState.date, onSaved: reload });
  });
  $("#aPhoto", rootEl).onclick = () => window.dispatchEvent(new Event("macrosnap:photo"));
  $("#aDescribe", rootEl).onclick = () => openReview({ mode: "describe", date: dayState.date, onSaved: reload });
  $("#aManual", rootEl).onclick = () => openReview({ mode: "manual", date: dayState.date, onSaved: reload });
}

const SPORTS = [["Run", "Run"], ["Walk", "Walk"], ["Ride", "Ride"], ["WeightTraining", "Strength"], ["Workout", "Workout / HYROX"], ["Crossfit", "CrossFit"], ["HighIntensityIntervalTraining", "HIIT"], ["Swim", "Swim"], ["Rowing", "Row"], ["Yoga", "Yoga"], ["Hike", "Hike"], ["Badminton", "Badminton"], ["Soccer", "Football"], ["Cricket", "Cricket"], ["Elliptical", "Elliptical"], ["StairStepper", "Stair stepper"]];

function activityDialog() {
  const body = openSheet(`<h3>Add training</h3>
    <label class="f">Name<input id="acName" placeholder="HYROX sim"></label>
    <div class="grid2">
      <label class="f">Type<select id="acSport">${SPORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
      <label class="f">Minutes<input id="acMin" type="number" inputmode="numeric" min="1"></label>
      <label class="f">Average heart rate<input id="acHr" type="number" inputmode="numeric" placeholder="If you know it"></label>
      <label class="f">Calories from your watch<input id="acKcal" type="number" inputmode="numeric" placeholder="If you know it"></label>
      <label class="f">Distance in km<input id="acKm" type="number" inputmode="decimal" step="0.01" placeholder="Runs and walks"></label>
      <label class="f">Climb in metres<input id="acElev" type="number" inputmode="numeric" placeholder="If you know it"></label>
    </div>
    <p class="tiny muted">The most reliable number wins: watch calories first, then pace and distance, then heart rate, then a standard estimate for the activity.</p>
    <div class="foot"><span class="grow"></span><button class="btn ghost" id="acCancel">Cancel</button><button class="btn primary" id="acSave">Add training</button></div>`, "modal");
  const v = (id) => { const x = $(id, body).value; return x === "" ? undefined : Number(x); };
  $("#acCancel", body).onclick = () => closeSheet("modal");
  $("#acSave", body).onclick = async () => {
    const minutes = v("#acMin");
    if (!minutes) return toast("Add how many minutes");
    const sel = $("#acSport", body);
    try {
      dayState.data = await post(`/api/day/${dayState.date}/activities`, {
        name: $("#acName", body).value || sel.options[sel.selectedIndex].text, sport: sel.value, minutes,
        avgHr: v("#acHr"), kcal: v("#acKcal"), distanceKm: v("#acKm"), elevationM: v("#acElev"),
      });
      closeSheet("modal"); draw(); toast("Training added");
    } catch (e) { toast(e.message); }
  };
}
