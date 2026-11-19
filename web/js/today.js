import { del, get, post, put } from "./api.js";
import { openReview } from "./review.js";
import { $, addDays, closeSheet, enter, esc, ICONS, n0, n1, openSheet, prettyDate, toast, today } from "./util.js";

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
  root.innerHTML = `${header()}${skeleton()}`;
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

function skeleton() {
  return `<div class="sk-wrap" aria-busy="true" aria-label="Loading today"><div class="sk sk-hero"></div><div class="sk sk-mac"></div><div class="sk sk-row"></div><div class="sk sk-row"></div></div>`;
}

function header() {
  return `<header class="daybar">
    <div class="title"><h1>${prettyDate(dayState.date)}</h1><p>${new Date(`${dayState.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p></div>
    <div class="daynav">
      <button class="round" id="prevDay" aria-label="Previous day">${CHEV_L}</button>
      <button class="round" id="nextDay" aria-label="Next day" ${dayState.date >= today() ? "disabled" : ""}>${CHEV_R}</button>
    </div>
  </header>`;
}
function bindHeader(root) {
  $("#prevDay", root).onclick = () => { dayState.date = addDays(dayState.date, -1); fresh = true; renderToday(root); };
  $("#nextDay", root).onclick = () => { if (dayState.date < today()) { dayState.date = addDays(dayState.date, 1); fresh = true; renderToday(root); } };
}

/* ---------- hero: the ring, what's left, and where today sits in your range ---------- */
const PILL = { low: "Under your minimum", band: "In range", high: "In range, lighter deficit", over: "Over maintenance", under: "Under your minimum" };
const RING_C = 389.6;
/** The first lap is split by where the calories came from: protein, carbs and fat each get their own colour. */
function ringSegments(d, first) {
  const m = d.totals, kc = [["p", m.protein * 4], ["c", m.carbs * 4], ["f", m.fat * 9]];
  const sum = kc.reduce((a, [, v]) => a + v, 0);
  if (!first || !sum) return "";
  const gap = kc.filter(([, v]) => v > 0).length > 1 ? 3 : 0;
  let at = 0;
  return kc.filter(([, v]) => v > 0).map(([k, v]) => {
    const len = RING_C * first * (v / sum), start = at; at += len;
    return `<circle cx="74" cy="74" r="62" class="ring-seg seg-${k}" stroke-dasharray="${Math.max(0.5, len - gap).toFixed(1)} ${RING_C}" stroke-dashoffset="${(-start).toFixed(1)}" transform="rotate(-90 74 74)"/>`;
  }).join("");
}

function hero(d, z) {
  const tg = d.targets, eaten = d.totals.kcal;
  const left = Math.round(tg.target - eaten);
  const frac = eaten / (tg.target || 1);
  const first = Math.min(1, frac), second = Math.min(1, Math.max(0, frac - 1));
  const exKcal = tg.exercise?.source === "activities" ? Math.round(tg.exercise.kcal) : 0;
  return `<section class="hero" aria-label="Calories">
    <div class="hero-main">
      <div class="ring" role="img" aria-label="${n0(eaten)} of ${n0(tg.target)} kcal eaten">
        <svg viewBox="0 0 148 148" width="148" height="148"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8febcf"/><stop offset="1" stop-color="#4fc9a5"/></linearGradient></defs>
          <circle cx="74" cy="74" r="62" class="ring-bg"/>
          ${ringSegments(d, first)}
          ${second ? `<circle cx="74" cy="74" r="62" class="ring-fg2" stroke-dasharray="${(RING_C * second).toFixed(1)} ${RING_C}" transform="rotate(-90 74 74)"/>` : ""}</svg>
        <div class="ring-in"><b class="num">${n0(eaten)}</b><span>${left >= 0 ? `of ${n0(tg.target)} kcal` : "past target"}</span></div>
      </div>
      <div class="hero-side">
        <span class="pill ${z.cls}">${z.pill || PILL[z.cls] || ""}</span>
        <div class="hero-num num">${n0(Math.abs(left))} kcal</div>
        <div class="hero-sub">${left >= 0 ? "left to your target" : "over your target"}</div>
        <div class="ring-key" aria-hidden="true"><span class="k-p">Protein</span><span class="k-c">Carbs</span><span class="k-f">Fat</span></div>
        ${exKcal ? `<div class="hero-inc num">Includes ${n0(exKcal)} kcal from your training</div>` : ""}
      </div>
    </div>
    ${rangeBar(d)}
    <p class="hero-note">${z.text}</p>
  </section>`;
}

/** One bar, five zones, one marker for today. The brightest zone is the plan. */
function rangeBar(d) {
  const r = d.targets.range, eaten = d.totals.kcal;
  const lo = r.floor * 0.6, max = Math.max(r.ceiling * 1.12, eaten * 1.04), span = max - lo;
  const pct = (v) => ((Math.min(Math.max(v, lo), max) - lo) / span) * 100;
  const zones = [[lo, r.floor, "var(--accent-1)"], [r.floor, r.bandLow, "var(--haldi)"], [r.bandLow, r.bandHigh, "var(--accent-5)"], [r.bandHigh, r.ceiling, "var(--mirch)"], [r.ceiling, max, "var(--accent-2)"]]
    .map(([a, b, c]) => `<i style="width:${Math.max(0, pct(b) - pct(a)).toFixed(2)}%;background:${c}"></i>`).join("");
  const top = d.goal?.type === "cut" && r.ceiling === d.targets.tdee ? "Maintenance" : "Limit";
  // Each label sits under the point it names. Keep them on the card and apart from each other.
  const labels = [{ t: "Min", v: r.floor }, { t: "Target", v: d.targets.target }, { t: top, v: r.ceiling }].map((l) => ({ ...l, x: Math.min(88, Math.max(12, pct(l.v))), at: pct(l.v) }));
  const GAP = 18;
  for (let i = 1; i < labels.length; i++) if (labels[i].x - labels[i - 1].x < GAP) { const push = (GAP - (labels[i].x - labels[i - 1].x)) / 2; labels[i - 1].x -= push; labels[i].x += push; }
  const ticks = labels.map((l) => `<i class="tick" style="left:${l.at.toFixed(2)}%"></i>`).join("");
  return `<div class="rangehead"><span>Today's range</span><button class="link-q" id="howSet">${ICONS.info}How it's set</button></div>
  <div class="rangebar" role="img" aria-label="Minimum ${n0(r.floor)}, target ${n0(d.targets.target)}, ${top.toLowerCase()} ${n0(r.ceiling)}, eaten ${n0(eaten)}"><div class="zones">${zones}</div>${ticks}<span class="you" style="left:${pct(eaten).toFixed(2)}%"></span></div>
  <div class="rangelabels">${labels.map((l) => `<div style="left:${l.x.toFixed(1)}%"><span>${l.t}</span><b class="num">${n0(l.v)}</b></div>`).join("")}</div>`;
}

function macros(d) {
  const t = d.targets, m = d.totals;
  const one = (label, eaten, goal) => `<div class="mac mc-${label[0].toLowerCase()}"><span class="mac-l">${label}</span>
      <div class="bar"><i style="--p:${Math.min(1, eaten / (goal || 1)).toFixed(3)}"></i></div>
      <span class="mac-v num">${n0(eaten)}<span> / ${n0(goal)} g</span></span></div>`;
  return `<section class="macros" aria-label="Macros">${one("Protein", m.protein, t.macros.protein)}${one("Carbs", m.carbs, t.macros.carbs)}${one("Fat", m.fat, t.macros.fat)}
    <p class="mac-fib num">Fibre ${n0(m.fiber)} / ${n0(t.macros.fiber)} g</p></section>`;
}

function presetSourceLabel(d) { return d.presetSource === "manual" ? "set by you" : d.presetSource === "activities" ? "from activities" : "suggested"; }

/**
 * On a cut, the top of the range is maintenance. Going over target but staying under it is still a deficit,
 * so say that plainly instead of letting it read as a failed day.
 */
function zone(eaten, r, inProgress, cut, maintenance) {
  if (cut && maintenance && eaten > r.bandHigh) {
    if (eaten < maintenance) return { cls: "high", pill: "Still in deficit", text: `Over target, but still in a deficit, just a smaller one: ${n0(maintenance - eaten)} kcal under maintenance${inProgress ? " so far" : ""}.` };
    return { cls: "over", pill: "Over maintenance", text: `${n0(eaten - maintenance)} kcal over maintenance${inProgress ? " so far" : ""}, so no deficit today. One day doesn't undo a week; the weekly average is what counts.` };
  }
  if (eaten < r.floor && inProgress) return { cls: "low", text: `Eat ${n0(r.bandLow - eaten)}–${n0(r.bandHigh - eaten)} more today.` };
  if (eaten < r.floor) return { cls: "under", text: `This day ended ${n0(r.floor - eaten)} kcal under your safe minimum.` };
  if (eaten < r.bandLow) return { cls: "low", pill: "Still in deficit", text: `Eat ${n0(r.bandLow - eaten)}–${n0(r.bandHigh - eaten)} more ${inProgress ? "today" : "to have hit your range"}.` };
  if (eaten <= r.bandHigh) return { cls: "band", text: "You're in your range for the day." };
  if (eaten <= r.ceiling) return { cls: "high", text: `A little over target. ${n0(r.ceiling - eaten)} kcal before your limit.` };
  return { cls: "over", text: `${n0(eaten - r.ceiling)} kcal past today's limit.` };
}

const dismissed = new Set(); // Strava suggestions dismissed for a day don't return that day
const hhmm = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const SRC_ICON = { photo: ICONS.plate, label: ICONS.plate, describe: ICONS.type, manual: ICONS.book };

function draw() {
  const d = dayState.data, t = d.targets, r = t.range, eaten = d.totals.kcal;
  const z = zone(eaten, r, dayState.date >= today(), d.goal?.type === "cut", t.tdee);

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

  const acts = d.activities.map((a) => `<div class="act-chip ${a.source === "strava" ? "" : "editable"}"${a.source === "strava" ? "" : ` role="button" tabindex="0" data-edit-act="${a.id}" aria-label="Edit ${esc(a.name)}"`}>
      ${ICONS.run}<span class="num">${esc(a.name)} · ${a.minutes} min · ${n0(a.kcalNet)} kcal</span>
      <span class="tag">${esc(METHOD[a.method] || a.method)}${a.source === "strava" ? " · Strava" : ""}</span>
      <button class="x" data-del-act="${a.id}" aria-label="Remove ${esc(a.name)}">${X_ICON}</button></div>`).join("");

  const meals = d.meals.map((m) => `<li><button class="meal" data-meal="${m.id}">
      ${m.thumb ? `<img class="tile" src="${m.thumb}" alt="" decoding="async">` : `<span class="tile">${SRC_ICON[m.source] || ICONS.plate}</span>`}
      <span class="grow"><span class="name">${esc(m.name)}</span>
        <span class="sub num">${esc(m.mealType)}${m.ts ? ` · ${hhmm(m.ts)}` : ""} · P ${n0(m.totals.protein)} · C ${n0(m.totals.carbs)} · F ${n0(m.totals.fat)}</span></span>
      <span class="kc num">${n0(m.totals.kcal)}</span></button></li>`).join("");

  // A suggestion, never an automatic change: accept it or keep what you have.
  const run = d.activities.find((a) => a.source === "strava") || d.activities[0];
  const sug = d.presets.find((p) => p.id === d.suggested);
  const banner = run && sug && d.suggested !== d.presetId && !dismissed.has(dayState.date) ? `<section class="banner" aria-label="Activity suggestion">
      <div class="banner-top"><span class="disc">${ICONS.bolt}</span><div><b>${d.activities.some((a) => a.source === "strava") ? "Strava found" : "You logged"} a ${run.minutes}-minute ${esc(run.sport.toLowerCase())}</b>
        <span>Your day is set to activity level ${esc(t.preset.label)}. Level ${esc(sug.label)} may fit better.</span></div></div>
      <div class="banner-act"><button class="btn ghost" id="bnKeep">Keep level ${esc(t.preset.label)}</button><button class="btn tonal" id="bnSet">Set level ${esc(sug.label)}</button></div></section>` : "";

  const ad = d.adaptive;
  rootEl.innerHTML = `${header()}
    ${hero(d, z)}
    ${macros(d)}
    ${banner}

    <section class="sec" aria-label="Training">
      <div class="sec-h"><h2>Training</h2><button class="link" id="addAct">Add session</button></div>
      <div class="chips-row">${acts}<button class="act-chip lvl" id="lvlChip">Activity level ${esc(t.preset.label)} of ${d.presets.length}</button></div>
      ${acts ? "" : `<p class="empty sm">No training logged. Until you add some, level ${esc(t.preset.label)} counts as +${n0(t.preset.defaultExerciseKcal)} kcal.</p>`}
      ${d.strava.enabled ? `<div class="row wrap tiny muted">${d.strava.connected ? `<button class="btn xs link" id="syncStrava">Sync Strava</button>` : `<a class="btn xs link" href="#/settings">Connect Strava</a>`}${d.strava.syncedAt ? `<span>Synced at ${new Date(d.strava.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>` : ""}</div>` : ""}
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
    </section>

    <section class="sec" aria-label="Meals">
      <div class="sec-h"><h2>Meals</h2><span class="h2-n num">${d.meals.length} logged</span>
        <span class="h2-act"><button class="btn xs ghost" id="aDescribe">Describe</button><button class="btn xs ghost" id="aManual">Enter</button></span></div>
      ${meals ? `<ul class="meals">${meals}</ul>` : `<div class="empty-card"><span class="disc">${ICONS.camera}</span><b>Nothing logged yet</b><p>Tap Log to snap your plate, or share a photo from your gallery.</p></div>`}
    </section>

    <section class="sec" aria-label="Weight">
      <div class="sec-h"><h2>Weight</h2><a class="link" href="#/weighins">Weigh-ins</a></div>
      <div class="card">
        <div class="spread"><label class="small" for="wKg">Morning weight</label>
          <div class="row"><input id="wKg" class="inline" style="width:108px;text-align:right" type="number" inputmode="decimal" step="0.1" placeholder="kg" value="${d.weight.today ?? ""}"><button class="btn sm" id="wSave">Save</button></div></div>
        <p class="tiny muted" style="margin:12px 0 0">${d.weight.trend ? `Trend weight ${n1(d.weight.trend)} kg. ` : ""}${ad.ready
          ? `Your real burn is about <b>${n0(ad.observedTdee)} kcal</b> a day, so targets are scaled ×${ad.k}.`
          : `Targets use formulas for now. To calibrate them to your body, ${esc(ad.reason)}.`}${d.warnings?.length ? ` ${d.warnings.map(esc).join(". ")}.` : ""}</p>
      </div>
    </section>`;

  bindHeader(rootEl);
  if (fresh) { fresh = false; enter(rootEl); }
  const reload = () => renderToday(rootEl, undefined, true);
  const openPlan = () => { planOpen = true; $("#plan", rootEl).open = true; $("#plan", rootEl).scrollIntoView({ block: "center", behavior: "smooth" }); };

  $("#howSet", rootEl).onclick = () => { calcOpen = true; $("#calcFold", rootEl).open = true; openPlan(); };
  $("#lvlChip", rootEl).onclick = openPlan;
  $("#bnKeep", rootEl)?.addEventListener("click", () => { dismissed.add(dayState.date); draw(); });
  $("#bnSet", rootEl)?.addEventListener("click", async () => { dismissed.add(dayState.date); dayState.data = await put(`/api/day/${dayState.date}`, { preset: d.suggested }); draw(); });
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
  rootEl.querySelectorAll("[data-edit-act]").forEach((el) => {
    const open = () => activityDialog(d.activities.find((a) => a.id === el.dataset.editAct));
    el.onclick = (e) => { if (!e.target.closest("[data-del-act]")) open(); };
    el.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); open(); } };
  });
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

function activityDialog(edit) {
  const val = (x) => (x == null ? "" : x);
  const body = openSheet(`<h3>${edit ? "Edit training" : "Add training"}</h3>
    <label class="f">Name<input id="acName" placeholder="HYROX sim" value="${esc(edit?.name || "")}"></label>
    <div class="grid2">
      <label class="f">Type<select id="acSport">${SPORTS.map(([v, l]) => `<option value="${v}" ${edit?.sport === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f">Minutes<input id="acMin" type="number" inputmode="numeric" min="1" value="${val(edit?.minutes)}"></label>
      <label class="f">Average heart rate<input id="acHr" type="number" inputmode="numeric" placeholder="If you know it" value="${val(edit?.avgHr)}"></label>
      <label class="f">Calories from your watch<input id="acKcal" type="number" inputmode="numeric" placeholder="If you know it" value="${val(edit?.kcalInput)}"></label>
      <label class="f">Distance in km<input id="acKm" type="number" inputmode="decimal" step="0.01" placeholder="Runs and walks" value="${val(edit?.distanceKm)}"></label>
      <label class="f">Climb in metres<input id="acElev" type="number" inputmode="numeric" placeholder="If you know it" value="${val(edit?.elevationM)}"></label>
    </div>
    <p class="tiny muted">The most reliable number wins: watch calories first, then pace and distance, then heart rate, then a standard estimate for the activity.</p>
    <div class="foot"><span class="grow"></span><button class="btn ghost" id="acCancel">Cancel</button><button class="btn primary" id="acSave">${edit ? "Save changes" : "Add training"}</button></div>`, "modal");
  const v = (id) => { const x = $(id, body).value; return x === "" ? undefined : Number(x); };
  $("#acCancel", body).onclick = () => closeSheet("modal");
  $("#acSave", body).onclick = async () => {
    const minutes = v("#acMin");
    if (!minutes) return toast("Add how many minutes");
    const sel = $("#acSport", body);
    try {
      const payload = {
        name: $("#acName", body).value || sel.options[sel.selectedIndex].text, sport: sel.value, minutes,
        avgHr: v("#acHr"), kcal: v("#acKcal"), distanceKm: v("#acKm"), elevationM: v("#acElev"),
      };
      dayState.data = edit ? await put(`/api/day/${dayState.date}/activities/${edit.id}`, payload) : await post(`/api/day/${dayState.date}/activities`, payload);
      closeSheet("modal"); draw(); toast(edit ? "Training updated" : "Training added");
    } catch (e) { toast(e.message); }
  };
}
