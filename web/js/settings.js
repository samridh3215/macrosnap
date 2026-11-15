import { del, get, local, put, saveLocal } from "./api.js";
import { profileProblem } from "./onboarding.js";
import { $, enter, esc, n0, toast } from "./util.js";

let me = null;

export async function renderSettings(root, params) {
  if (params.get("strava")) {
    const m = { connected: "Strava connected ✓", denied: "Strava access was denied", bad_state: "Strava link expired — try again", need_activity_scope: "Allow 'View data about your activities' to sync" }[params.get("strava")];
    if (m) toast(m, 3500);
    history.replaceState(null, "", "#/settings");
  }
  root.innerHTML = `<h1>Settings</h1>${connectionCard()}<div id="rest"><p class="empty"><span class="spin"></span>Loading…</p></div>`;
  bindConnection(root);
  try { me = await get("/api/me"); } catch (e) {
    $("#conn", root).open = true;
    $("#rest", root).innerHTML = `<div class="card"><b>${esc(e.message)}</b><p class="small muted" style="margin:6px 0 0">Set the app token above (it must match APP_TOKEN on the server).</p></div>`;
    return;
  }
  drawRest(root);
  enter($("#rest", root));
}

const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>`;

function connectionCard() {
  const cur = (() => { try { return localStorage.getItem("theme") || "dark"; } catch { return "dark"; } })();
  return `<h2>Appearance</h2><div class="card">
    <div class="seg" id="sTheme" role="group" aria-label="Theme">${["dark", "light", "system"].map((t) => `<button data-t="${t}" class="${cur === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
  </div>
  <details class="acc" id="conn"><summary>Connection<span class="acc-s">${local.token ? "Token saved" : "Needs a token"}</span>${CHEV}</summary><div class="acc-b">
    <label class="f">App token (matches APP_TOKEN on the server)<input id="sToken" type="password" autocomplete="off" value="${esc(local.token || "")}"></label>
    <label class="f"><span>OpenRouter API key <span class="tiny">(stored only on this phone, sent with each request)</span></span><input id="sOr" type="password" autocomplete="off" placeholder="sk-or-…" value="${esc(local.orKey || "")}"></label>
    <div class="row"><button class="btn sm primary" id="sConnSave">Save</button><button class="btn sm" id="sTest">Test</button><span class="small muted" id="sTestOut"></span></div>
  </div></details>`;
}

function bindConnection(root) {
  document.querySelectorAll("#sTheme button").forEach((b) => b.onclick = () => {
    const t = b.dataset.t;
    try { localStorage.setItem("theme", t); } catch {}
    document.documentElement.dataset.theme = t;
    document.querySelector("meta[name=theme-color]")?.setAttribute("content", t === "light" || (t === "system" && matchMedia("(prefers-color-scheme: light)").matches) ? "#f3f1ec" : "#0d0f11");
    document.querySelectorAll("#sTheme button").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("#sConnSave", root).onclick = () => { saveLocal({ token: $("#sToken", root).value.trim(), orKey: $("#sOr", root).value.trim() }); toast("Saved on this device"); renderSettings(root, new URLSearchParams()); };
  $("#sTest", root).onclick = async () => {
    const out = $("#sTestOut", root); out.innerHTML = `<span class="spin"></span>`;
    try {
      const h = await get("/api/health");
      const m = await get("/api/models/resolved");
      out.textContent = `✓ ${h.store} · ${h.cache} · ${h.llm} · ${m.vision.split("/").pop()} → ${m.reasoning.split("/").pop()}`;
    } catch (e) { out.textContent = `✕ ${e.message}`; }
  };
}

function drawRest(root) {
  const p = me.profile, s = me.settings, b = me.bmr;
  const presetRows = me.presetOrder.map((id) => {
    const pr = me.presets[id];
    return `<div class="preset" data-preset="${id}"><b>${esc(pr.label)}</b><div class="tiny muted">${esc(pr.blurb)}</div>
      <div class="preset-grid">
        <label>Movement ×BMR<input data-f="neat" type="number" step="0.025" min="1" max="2" value="${pr.neat}"></label>
        <label>Default exercise kcal<input data-f="defaultExerciseKcal" type="number" step="25" min="0" value="${pr.defaultExerciseKcal}"></label>
        <label>Fat %<input data-f="fatPct" type="number" step="1" min="10" max="50" value="${Math.round(pr.fatPct * 100)}"></label>
        <label>Protein ± g/kg<input data-f="proteinDeltaGPerKg" type="number" step="0.1" min="-1" max="1" value="${pr.proteinDeltaGPerKg}"></label>
      </div></div>`;
  }).join("");

  $("#rest", root).innerHTML = `
    <h2>Body</h2>
    <div class="card">
      <div class="grid2">
        <label class="f">Weight (kg)<input id="pW" type="number" inputmode="decimal" step="0.1" value="${p.weightKg ?? ""}"></label>
        <label class="f">Height (cm)<input id="pH" type="number" inputmode="decimal" value="${p.heightCm ?? ""}"></label>
        <label class="f">Age<input id="pA" type="number" inputmode="numeric" value="${p.age ?? ""}"></label>
        <label class="f">Sex<select id="pS"><option value="">Not set</option><option value="male" ${p.sex === "male" ? "selected" : ""}>Male</option><option value="female" ${p.sex === "female" ? "selected" : ""}>Female</option></select></label>
        <label class="f"><span>Body fat % <span class="tiny">(optional)</span></span><input id="pBf" type="number" inputmode="decimal" step="0.5" value="${p.bodyFatPct ?? ""}"></label>
      </div>
      <label class="check"><input type="checkbox" id="pAth" ${p.athlete ? "checked" : ""}> Train 5+ times a week</label>
      <div class="small">BMR <b class="num">${n0(b.kcal)} kcal</b> via <b>${esc(b.formula)}</b>${b.lbmKg ? ` · lean mass ${b.lbmKg} kg` : ""}</div>
      <details class="fold"><summary class="tiny" style="color:var(--ink-soft);margin-top:8px">How this was picked</summary>
        <p class="tiny muted" style="margin:6px 0 0">${b.candidates.map((c) => `${esc(c.formula)} ${n0(c.kcal)}`).join(" · ")}${b.assumptions.length ? ` · ${b.assumptions.map(esc).join(" · ")}` : ""}</p>
        <p class="tiny muted">Enter whatever you know. The best formula for your data is picked automatically (body fat → Katch–McArdle/Cunningham; height and age → Mifflin–St Jeor).</p></details>
    </div>

    <h2>Goal</h2>
    <div class="card">
      <div class="seg" id="gType">${["cut", "maintain", "bulk"].map((g) => `<button data-g="${g}" class="${s.goal.type === g ? "on" : ""}">${{ cut: "Lose fat", maintain: "Maintain", bulk: "Gain muscle" }[g]}</button>`).join("")}</div>
      <label class="f" style="margin-top:14px">Rate (% body weight per week) <input id="gRate" type="number" inputmode="decimal" step="0.05" min="0" max="1.5" value="${s.goal.ratePctPerWeek}"></label>
      <div class="tiny muted" id="gPreview" style="margin:-6px 0 14px"></div>
      <div class="grid2">
        <label class="f">Default day type<select id="sDef">${me.presetOrder.map((id) => `<option value="${id}" ${s.defaultPreset === id ? "selected" : ""}>${esc(me.presets[id].label)}</option>`).join("")}</select></label>
        <label class="f">Eat back exercise (%)<input id="sEat" type="number" inputmode="numeric" min="0" max="100" step="5" value="${Math.round(s.eatBack * 100)}"></label>
      </div>
      <label class="f" style="margin-bottom:0">Time zone<input id="sTz" value="${esc(s.tz)}"></label>
    </div>

    <details class="acc" style="margin-top:12px"><summary>Day types<span class="acc-s">Fine-tune</span>${CHEV}</summary><div class="acc-b">
      <p class="tiny muted" style="margin:0">Each day type sets how active you are and how macros are split. The defaults are a good start.</p>
      ${presetRows}
      <p class="tiny muted">Movement is the non-exercise activity multiplier. Default exercise is used only when no activity is logged or synced. Carbs fill what's left after protein and fat, so harder days get more carbs.</p>
      <button class="btn xs ghost" id="pReset">Reset to defaults</button>
    </div></details>
    <div class="save-row"><button class="btn primary" id="saveAll">Save body, goal and day types</button></div>

    <h2>Integrations</h2>
    <details class="acc"><summary>AI models<span class="acc-s">${s.models.mode === "auto" ? "Auto" : "Manual"}</span>${CHEV}</summary><div class="acc-b">
      <div class="seg" id="mMode"><button data-m="auto" class="${s.models.mode === "auto" ? "on" : ""}">Auto</button><button data-m="manual" class="${s.models.mode === "manual" ? "on" : ""}">Manual</button></div>
      <div id="mAuto" class="small muted ${s.models.mode === "auto" ? "" : "hidden"}" style="margin-top:12px">Picks the newest fast vision model and a strong reasoning model from OpenRouter's live catalogue. <span id="mResolved"></span></div>
      <div id="mManual" class="${s.models.mode === "manual" ? "" : "hidden"}" style="margin-top:12px">
        <input id="mFilter" placeholder="Filter models (e.g. claude, gpt, qwen)…" style="margin-bottom:12px">
        <label class="f">Vision model, identifies food in photos<select id="mVision"><option>${esc(s.models.vision || "")}</option></select></label>
        <label class="f">Reasoning model, derives nutrition per 100 g<select id="mReason"><option>${esc(s.models.reasoning || "")}</option></select></label>
        <div class="tiny muted">Prices are USD per million tokens (in/out). The reasoning model runs only for foods not yet in your library.</div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn sm primary" id="mSave">Save models</button></div>
    </div></details>
    <details class="acc"><summary>Strava<span class="acc-s">${!me.strava.enabled ? "Not configured" : me.strava.connected ? "Connected" : "Not connected"}</span>${CHEV}</summary><div class="acc-b">
      ${!me.strava.enabled ? `<p class="small muted" style="margin:0">Not configured on the server. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (see README).</p>`
        : me.strava.connected ? `<div class="spread"><span>Connected as <b>${esc(me.strava.athlete || "athlete")}</b></span><button class="btn sm ghost danger" id="stOff">Disconnect</button></div>
          <p class="tiny muted" style="margin-bottom:0">Today's and yesterday's activities sync automatically when you open the day; older days via Sync Strava.</p>`
        : `<button class="btn" id="stOn">Connect Strava</button><p class="tiny muted" style="margin-bottom:0">Uses watch calories when available, otherwise power, pace or heart rate.</p>`}
    </div></details>
    <p class="tiny muted" style="text-align:center;margin-top:24px">Macro Snap · ${esc(me.uid)} · ${esc(me.llm)}</p>`;

  bindRest(root);
}

function bindRest(root) {
  let mode = me.settings.models.mode, goalType = me.settings.goal.type, models = null;

  // Vision list needs image-capable models specifically.
  const loadVision = async () => {
    try {
      const vis = await get("/api/models?cap=vision");
      models = models || (await get("/api/models"));
      const f = ($("#mFilter", root).value || "").toLowerCase();
      const opt = (m) => `<option value="${esc(m.id)}">${esc(m.id)} · $${m.inPerM}/$${m.outPerM}</option>`;
      const vSel = $("#mVision", root), rSel = $("#mReason", root);
      const vCur = vSel.value || me.settings.models.vision, rCur = rSel.value || me.settings.models.reasoning;
      vSel.innerHTML = vis.filter((m) => !f || m.id.includes(f)).map(opt).join("");
      rSel.innerHTML = models.filter((m) => !f || m.id.includes(f)).map(opt).join("");
      if (vCur) vSel.value = vCur; if (rCur) rSel.value = rCur;
    } catch (e) { toast(e.message); }
  };

  get("/api/models/resolved").then((r) => { const el = $("#mResolved", root); if (el) el.innerHTML = `Currently: <b>${esc(r.vision)}</b> → <b>${esc(r.reasoning)}</b>${r.note ? ` (${esc(r.note)})` : ""}`; }).catch(() => {});
  $("#mMode", root).onclick = (e) => {
    const m = e.target.dataset.m; if (!m) return; mode = m;
    root.querySelectorAll("#mMode button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    $("#mAuto", root).classList.toggle("hidden", m !== "auto"); $("#mManual", root).classList.toggle("hidden", m !== "manual");
    if (m === "manual") loadVision();
  };
  if (mode === "manual") loadVision();
  $("#mFilter", root).oninput = () => loadVision();
  $("#mSave", root).onclick = async () => {
    const models = mode === "manual" ? { mode, vision: $("#mVision", root).value || undefined, reasoning: $("#mReason", root).value || undefined } : { mode: "auto" };
    if (mode === "manual" && (!models.vision || !models.reasoning)) return toast("Pick both models");
    me = { ...me, ...(await put("/api/me", { settings: { models } })) };
    toast("Models saved");
  };

  const preview = () => {
    const w = Number($("#pW", root).value) || me.profile.weightKg || 70, rate = Number($("#gRate", root).value) || 0;
    $("#gPreview", root).textContent = goalType === "maintain" ? "Targets aim to hold your weight." : `≈ ${(w * rate / 100).toFixed(2)} kg/week · ≈ ${n0(w * rate / 100 * 7700 / 7)} kcal/day ${goalType === "cut" ? "deficit" : "surplus"} (capped for safety)`;
  };
  $("#gType", root).onclick = (e) => { const g = e.target.dataset.g; if (!g) return; goalType = g; root.querySelectorAll("#gType button").forEach((b) => b.classList.toggle("on", b.dataset.g === g)); preview(); };
  $("#gRate", root).oninput = preview; $("#pW", root).oninput = preview; preview();

  $("#pReset", root).onclick = async () => { me = { ...me, ...(await put("/api/me", { settings: { presets: {} } })) }; toast("Day types reset"); drawRest(root); };

  $("#saveAll", root).onclick = async () => {
    const num = (id) => { const v = $(id, root).value; return v === "" ? undefined : Number(v); };
    const profile = { weightKg: num("#pW"), heightCm: num("#pH"), age: num("#pA"), sex: $("#pS", root).value || undefined, bodyFatPct: num("#pBf"), athlete: $("#pAth", root).checked || undefined };
    const problem = profileProblem(profile);
    if (problem) return toast(problem);
    const presets = {};
    root.querySelectorAll("[data-preset]").forEach((tr) => {
      const get1 = (f) => Number(tr.querySelector(`[data-f=${f}]`).value);
      presets[tr.dataset.preset] = { neat: get1("neat"), defaultExerciseKcal: get1("defaultExerciseKcal"), fatPct: get1("fatPct") / 100, proteinDeltaGPerKg: get1("proteinDeltaGPerKg") };
    });
    try {
      const r = await put("/api/me", { profile, settings: { goal: { type: goalType, ratePctPerWeek: Number($("#gRate", root).value) || 0 }, defaultPreset: $("#sDef", root).value, eatBack: (Number($("#sEat", root).value) || 0) / 100, tz: $("#sTz", root).value.trim() || "Asia/Kolkata", presets } });
      me = { ...me, ...r };
      toast("Saved"); drawRest(root);
    } catch (e) { toast(e.message); }
  };

  $("#stOn", root)?.addEventListener("click", () => { location.href = `/api/strava/connect?t=${encodeURIComponent(local.token || "")}`; });
  $("#stOff", root)?.addEventListener("click", async () => { if (!confirm("Disconnect Strava?")) return; await del("/api/strava"); toast("Disconnected"); me = await get("/api/me"); drawRest(root); });
}
