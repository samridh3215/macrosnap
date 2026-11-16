import { del, get, post, put } from "./api.js";
import { openReview } from "./review.js";
import { $, addDays, closeSheet, enter, esc, n0, n1, openSheet, prettyDate, toast, today } from "./util.js";

export const dayState = { date: today(), data: null };
let rootEl = null;
let fresh = true;        // true until the first paint of a day, so only arrivals animate
let planOpen = false;    // the day-type panel stays open across redraws
let calcOpen = false;    // so does the working-out fold inside it
const CHIP = {}; // activity levels are just 1 to 5

const METHOD = { device: "watch calories", power: "power meter", acsm: "pace model", hr: "heart rate", met: "activity estimate", manual: "entered" };
const CHEV_L = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l-6 6 6 6"/></svg>`;
const CHEV_R = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6l6 6-6 6"/></svg>`;
const CHEV_D = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON = {
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.3" r="3.4"/></svg>`,
  talk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 19l1-4L16 5l3 3L9 18z"/></svg>`,
  plate: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/></svg>`,
};

export async function renderToday(root, _params, quiet = false) {
  rootEl = root;
  fresh = !quiet;        // arrivals animate; reloads after a save don't
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
    <div class="title">${prettyDate(dayState.date)}<span class="tiny">${new Date(`${dayState.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span></div>
    <div class="daynav">
      <button class="icon-btn" id="prevDay" aria-label="Previous day">${CHEV_L}</button>
      <button class="icon-btn" id="nextDay" aria-label="Next day" ${dayState.date >= today() ? "disabled" : ""}>${CHEV_R}</button>
    </div>
  </div>`;
}
function bindHeader(root) {
  $("#prevDay", root).onclick = () => { dayState.date = addDays(dayState.date, -1); fresh = true; renderToday(root); };
  $("#nextDay", root).onclick = () => { if (dayState.date < today()) { dayState.date = addDays(dayState.date, 1); fresh = true; renderToday(root); } };
}

/* ---------- hero: what's left, where you sit in your range ---------- */
const PILL = { low: "Under range", band: "In range", high: "Slightly over", over: "Over limit", under: "Too low" };
function hero(d, z) {
  const tg = d.targets, eaten = d.totals.kcal;
  const left = Math.round(tg.target - eaten);
  const big = left >= 0 ? n0(left) : `+${n0(-left)}`;
  return `<section class="hero">
    <div class="hero-top"><span class="eyebrow">${left >= 0 ? "Calories left" : "Calories over"}</span><span class="pill ${z.cls}">${PILL[z.cls] || ""}</span></div>
    <div class="hero-num num">${big}<small>kcal</small></div>
    <div class="hero-sub"><b class="num">${n0(eaten)}</b> eaten of ${n0(tg.target)} target</div>
    ${rangeLine(d)}
    <p class="hero-note">${z.text}</p>
  </section>`;
}

function macros(d) {
  const t = d.targets, m = d.totals;
  const one = (cls, label, eaten, goal) => `<div class="mac ${cls}">
      <span class="mac-l">${label}</span>
      <b class="num">${n0(eaten)}</b><span class="mac-of num">of ${n0(goal)} g</span>
      <div class="bar"><i style="--p:${Math.min(1, eaten / (goal || 1)).toFixed(3)}"></i></div></div>`;
  return `<div class="macros">${one("m-p", "Protein", m.protein, t.macros.protein)}${one("m-c", "Carbs", m.carbs, t.macros.carbs)}${one("m-f", "Fat", m.fat, t.macros.fat)}${one("m-fi", "Fiber", m.fiber, t.macros.fiber)}</div>`;
}

function presetSourceLabel(d) { return d.presetSource === "manual" ? "set by you" : d.presetSource === "activities" ? "from activities" : "suggested"; }

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

  const presetChips = d.presets.map((p) => `<button class="chip ${p.id === d.presetId ? "on" : ""} ${p.id === d.suggested ? "sugg" : ""}" data-preset="${p.id}" title="${esc(p.blurb)}" aria-label="Level ${esc(p.label)}: ${esc(p.blurb)}">${esc(CHIP[p.id] || p.label)}</button>`).join("");
  const presetNote = d.presetSource === "manual" ? `Your pick. Tap it again to go automatic.`
    : d.presetSource === "activities" ? `Picked from today's activities.` : `${esc(t.preset.blurb)}.`;

  const calc = [
    [`Resting burn (${esc(t.bmr.formula)})`, n0(t.bmr.kcal)],
    [`With daily movement, level ${esc(t.preset.label)} ×${t.preset.neat}`, n0(t.neatKcal)],
    [t.exercise.source === "activities" ? `Exercise, ${Math.round(t.exercise.eatBack * 100)}% of logged` : "Exercise, day-type default", `+${n0(t.exercise.kcal)}`],
    ...(t.adaptive.applied ? [[`Calibrated to your weight trend ×${t.adaptive.k}`, n0(t.tdee)]] : [["Total burn", n0(t.tdee)]]),
    ...(t.goalDelta ? [[d.goal.type === "cut" ? `Fat-loss deficit (${d.goal.ratePctPerWeek}% a week)` : `Muscle-gain surplus (${d.goal.ratePctPerWeek}% a week)`, `${t.goalDelta > 0 ? "+" : "−"}${n0(Math.abs(t.goalDelta))}`]] : []),
    ["Today's target", n0(t.target)],
  ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");

  const acts = d.activities.map((a) => `<li class="li">
      <div class="grow"><div class="name">${esc(a.name)}</div><div class="sub">${esc(a.sport)}, ${a.minutes} min${a.avgHr ? `, ${a.avgHr} bpm` : ""}. From ${METHOD[a.method] || a.method}${a.source === "strava" ? " via Strava" : ""}.</div></div>
      <div class="kcal">+${n0(a.kcalNet)}<small>kcal</small></div>
      <button class="icon-btn" style="width:40px;height:40px;margin-right:-8px;color:var(--ink-faint)" data-del-act="${a.id}" aria-label="Remove ${esc(a.name)}">${X_ICON}</button></li>`).join("");

  const meals = d.meals.map((m) => `<li class="li tap" data-meal="${m.id}">
      ${m.thumb ? `<img class="thumb" src="${m.thumb}" alt="" decoding="async">` : `<div class="thumb">${ICON.plate}</div>`}
      <div class="grow"><div class="name">${esc(m.name)}</div>
        <div class="sub">${esc(m.mealType)} · <span class="m-p">${n0(m.totals.protein)}p</span> <span class="m-c">${n0(m.totals.carbs)}c</span> <span class="m-f">${n0(m.totals.fat)}f</span></div></div>
      <div class="kcal">${n0(m.totals.kcal)}<small>kcal</small></div></li>`).join("");

  const ad = d.adaptive;
  rootEl.innerHTML = `${header()}
    ${hero(d, z)}
    ${macros(d)}

    <details class="plan" id="plan" ${planOpen ? "open" : ""}>
      <summary><span class="ps-l">Activity level</span><span class="ps-v">${esc(t.preset.label)}</span><span class="ps-s">${presetSourceLabel(d)}</span>${CHEV_D}</summary>
      <div class="plan-body">
        <div class="chips" id="presets" role="radiogroup" aria-label="Activity level, 1 least active to 5 super active">${presetChips}</div>
        <p class="preset-note">${presetNote}</p>
        ${t.warnings.length ? `<p class="small plan-warn">${t.warnings.map(esc).join(". ")}.</p>` : ""}
        <details class="calc-fold" id="calcFold" ${calcOpen ? "open" : ""}>
          <summary>How the target is worked out${CHEV_D}</summary>
          <table class="calc">${calc}</table>
          <p class="tiny muted">Protein is set at ${esc(t.macros.basis)}. Fat follows the activity level and carbs fill the rest, so hard days get more carbs.</p>
        </details>
      </div>
    </details>

    <h2>Meals <span class="h2-n num">${n0(d.totals.kcal)} kcal</span>
      <span class="h2-act"><button class="btn xs ghost" id="aDescribe">Describe</button><button class="btn xs ghost" id="aManual">Enter</button></span></h2>
    ${meals ? `<ul class="list">${meals}</ul>` : `<div class="empty-card">${ICON.camera}<b>Nothing logged yet</b><p>Tap the camera to snap your plate, or share a photo from your gallery.</p></div>`}

    <h2>Training <span class="h2-act"><button class="btn xs ghost" id="addAct">+ Add</button></span></h2>
    ${acts ? `<ul class="list">${acts}</ul>` : `<p class="empty">No training logged. Until you add some, level ${esc(t.preset.label)} counts as +${n0(t.preset.defaultExerciseKcal)} kcal.</p>`}
    ${d.strava.enabled ? `<div class="row wrap tiny muted" style="margin-top:6px">${d.strava.connected ? `<button class="btn xs link" id="syncStrava">Sync Strava</button>` : `<a class="btn xs link" href="#/settings">Connect Strava</a>`}${d.strava.syncedAt ? `<span>Synced at ${new Date(d.strava.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>` : ""}</div>` : ""}

    <h2>Weight</h2>
    <div class="card">
      <div class="spread"><label class="small" for="wKg">Morning weight</label>
        <div class="row"><input id="wKg" class="inline" style="width:108px;text-align:right" type="number" inputmode="decimal" step="0.1" placeholder="kg" value="${d.weight.today ?? ""}"><button class="btn sm" id="wSave">Save</button></div></div>
      <p class="tiny muted" style="margin:12px 0 0">${d.weight.trend ? `Trend weight ${n1(d.weight.trend)} kg. ` : ""}${ad.ready
        ? `Your real burn is about <b>${n0(ad.observedTdee)} kcal</b> a day, so targets are scaled ×${ad.k}.`
        : `Targets use formulas for now. To calibrate them to your body, ${esc(ad.reason)}.`}${d.warnings?.length ? ` ${d.warnings.map(esc).join(". ")}.` : ""}</p>
    </div>`;

  bindHeader(rootEl);
  if (fresh) { fresh = false; enter(rootEl); }
  const reload = () => renderToday(rootEl, undefined, true);

  $("#plan", rootEl).addEventListener("toggle", (e) => { if (e.target.id === "plan") planOpen = e.target.open; });
  $("#calcFold", rootEl).addEventListener("toggle", (e) => { calcOpen = e.target.open; });
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
