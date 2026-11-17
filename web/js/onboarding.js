import { get, put } from "./api.js";
import { $, enter, esc, toast, today } from "./util.js";

const LIMITS = {
  weightKg: [25, 350, "Weight must be between 25 and 350 kg"],
  heightCm: [100, 250, "Height must be between 100 and 250 cm"],
  age: [10, 100, "Age must be between 10 and 100"],
};

/** The first problem with a body profile, or "" when it is usable. Shared with Settings so it can't be emptied again. */
export function profileProblem(p) {
  for (const [k, [lo, hi, msg]] of Object.entries(LIMITS)) {
    if (!p[k]) return `Enter your ${{ weightKg: "weight", heightCm: "height", age: "age" }[k]}`;
    if (p[k] < lo || p[k] > hi) return msg;
  }
  if (p.sex !== "male" && p.sex !== "female") return "Choose male or female";
  return "";
}

/**
 * Resolves once the profile has weight, height, age and sex. Shows a four-step setup until then.
 * If the server can't be reached (no token yet), it lets the app open so Settings can fix the connection.
 */
export async function ensureProfile() {
  let me;
  try { me = await get("/api/me"); } catch { return; }
  if (!me.profileMissing?.length) return;
  await new Promise((done) => showGate(me, done));
}

const MARK = `<div class="gate-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9.5"/><circle cx="8.5" cy="14.5" r="2.2"/><circle cx="15.5" cy="14.5" r="2.2"/><circle cx="12" cy="8.3" r="2.2"/></svg></div>`;
const STEPS = ["About you", "Body", "Goal", "Activity"];
const GOALS = { cut: ["Lose fat", 0.5], maintain: ["Maintain", 0], bulk: ["Gain muscle", 0.25] };

function showGate(me, done) {
  const profile = me.profile || {};
  const st = { step: 0, sex: profile.sex || "", bf: profile.bodyFatPct != null, athlete: !!profile.athlete,
    goal: me.settings?.goal?.type || "cut", rate: me.settings?.goal?.ratePctPerWeek ?? GOALS.cut[1], preset: me.settings?.defaultPreset || me.presetOrder?.[2] || "3" };
  const el = document.createElement("section");
  el.className = "gate setup";
  el.setAttribute("aria-labelledby", "gateTitle");
  document.body.append(el);
  document.body.classList.add("gated");

  const val = (id, fallback) => { const x = $(id, el); return x ? x.value : fallback; };
  const keep = () => { // pull whatever is on screen into state before the step changes
    if (st.step === 0) { profile.age = val("#gA", profile.age) === "" ? undefined : Number(val("#gA", profile.age)); }
    if (st.step === 1) {
      profile.heightCm = val("#gH", profile.heightCm) === "" ? undefined : Number(val("#gH", profile.heightCm));
      profile.weightKg = val("#gW", profile.weightKg) === "" ? undefined : Number(val("#gW", profile.weightKg));
      profile.bodyFatPct = st.bf && val("#gBf", "") !== "" ? Number(val("#gBf", "")) : undefined;
    }
    if (st.step === 2) st.rate = Number(val("#gRate", st.rate)) || 0;
  };
  const formula = () => st.bf ? ["Katch–McArdle", "Uses your lean mass, so it is the most accurate when body fat is known."]
    : st.athlete ? ["Cunningham", "Suits athletic builds with more muscle than average."] : ["Mifflin–St Jeor", "The standard estimate from height, weight, age and sex."];
  const field = (id, label, value, unit, mode = "decimal") => `<div class="fld"><label for="${id}">${label}</label><div class="unit"><input id="${id}" type="number" inputmode="${mode}" step="any" autocomplete="off" value="${esc(value ?? "")}"><span>${unit}</span></div></div>`;
  const toggle = (id, title, sub, on) => `<label class="switch-row"><span><b>${title}</b><small>${sub}</small></span><input type="checkbox" role="switch" id="${id}" ${on ? "checked" : ""}></label>`;

  const problem = () => {
    if (st.step === 0) { if (!profile.age) return "Enter your age"; if (profile.age < 10 || profile.age > 100) return LIMITS.age[2]; if (st.sex !== "male" && st.sex !== "female") return "Choose male or female"; }
    if (st.step === 1) {
      for (const k of ["heightCm", "weightKg"]) { const [lo, hi, msg] = LIMITS[k]; if (!profile[k]) return `Enter your ${k === "heightCm" ? "height" : "weight"}`; if (profile[k] < lo || profile[k] > hi) return msg; }
      if (st.bf && (profile.bodyFatPct == null || profile.bodyFatPct < 3 || profile.bodyFatPct > 60)) return "Body fat must be between 3 and 60 %";
    }
    return "";
  };

  const draw = () => {
    const [fName, fWhy] = formula();
    const bodies = [
      `<div class="fields"><div class="fld"><label for="gA">Age</label><div class="unit"><input id="gA" type="number" inputmode="numeric" autocomplete="off" value="${esc(profile.age ?? "")}"><span>years</span></div></div>
        <div class="fld" role="group" aria-labelledby="gSexL"><span id="gSexL" class="lab">Sex</span><div class="seg" id="gSex"><button type="button" data-s="male" class="${st.sex === "male" ? "on" : ""}" aria-pressed="${st.sex === "male"}">Male</button><button type="button" data-s="female" class="${st.sex === "female" ? "on" : ""}" aria-pressed="${st.sex === "female"}">Female</button></div></div></div>
        <p class="tiny muted">Used only to estimate your resting energy.</p>`,
      `<div class="fields two">${field("gH", "Height", profile.heightCm, "cm", "numeric")}${field("gW", "Weight", profile.weightKg, "kg")}</div>
        <div class="group">${toggle("gBfT", "I know my body-fat %", "From a DEXA scan, smart scale or calipers", st.bf)}
          ${st.bf ? `<div class="fld inset">${`<label for="gBf">Body fat</label><div class="unit"><input id="gBf" type="number" inputmode="decimal" step="0.5" value="${esc(profile.bodyFatPct ?? "")}"><span>%</span></div>`}</div>` : ""}
          <div class="sep"></div>${toggle("gAth", "I train hard most weeks", "Five or more structured sessions a week", st.athlete)}</div>
        <div class="formula" aria-live="polite"><span>Formula we'll use</span><b>${fName}</b><small>${fWhy}</small></div>`,
      `<div class="seg" id="gGoal" role="group" aria-label="Goal">${Object.entries(GOALS).map(([g, [l]]) => `<button type="button" data-g="${g}" class="${st.goal === g ? "on" : ""}" aria-pressed="${st.goal === g}">${l}</button>`).join("")}</div>
        ${st.goal === "maintain" ? `<p class="body-s muted">Targets aim to hold your weight.</p>` : `<div class="fields">${field("gRate", "Rate, % of body weight per week", st.rate, "%")}</div>
        <p class="tiny muted">${profile.weightKg ? `≈ ${(profile.weightKg * st.rate / 100).toFixed(2)} kg a week. ` : ""}Capped for safety. You can change this any time.</p>`}`,
      `<div class="levels" role="radiogroup" aria-label="Default activity level">${(me.presetOrder || ["1", "2", "3", "4", "5"]).map((id) => { const p = me.presets?.[id] || { label: id, blurb: "" }; return `<button type="button" role="radio" aria-checked="${st.preset === id}" data-p="${id}" class="level ${st.preset === id ? "on" : ""}"><b>${esc(p.label)}</b><span>${esc(p.blurb)}</span></button>`; }).join("")}</div>
        <p class="tiny muted">Your usual day. Training you log moves a day up or down from here.</p>`,
    ];
    const titles = [["Step 1 of 4 · About you", "A little about you", "These set your daily range. You can change them later in Settings."], ["Step 2 of 4 · Body", "Your measurements", "These set your daily range. You can change them later in Settings."], ["Step 3 of 4 · Goal", "What are you aiming for?", "This sets how far below or above maintenance your target sits."], ["Step 4 of 4 · Activity", "How active is a normal day?", "Pick the closest. Logged training adjusts it day by day."]];
    const [eyebrow, title, sub] = titles[st.step];
    el.innerHTML = `<div class="gate-in">
      <header><div class="steps" role="img" aria-label="Step ${st.step + 1} of 4">${STEPS.map((_, i) => `<i class="${i <= st.step ? "on" : ""}"></i>`).join("")}</div>
        ${st.step === 0 ? MARK : ""}<span class="eyebrow">${eyebrow}</span><h1 id="gateTitle">${title}</h1><p class="gate-sub">${sub}</p></header>
      <form id="gateForm" novalidate>${bodies[st.step]}
        <p class="gate-err small" id="gErr" role="alert"></p>
        <footer class="setup-foot">${st.step ? `<button type="button" class="btn" id="gBack">Back</button>` : ""}<button class="btn primary grow" id="gGo" type="submit">${["Continue", "Continue to goal", "Continue", "Finish setup"][st.step]}</button></footer>
      </form></div>`;
    enter(el);
    $("#gSex", el)?.addEventListener("click", (e) => { const s = e.target.dataset.s; if (!s) return; st.sex = s; el.querySelectorAll("#gSex button").forEach((b) => { b.classList.toggle("on", b.dataset.s === s); b.setAttribute("aria-pressed", b.dataset.s === s); }); });
    $("#gBfT", el)?.addEventListener("change", (e) => { keep(); st.bf = e.target.checked; draw(); $("#gBf", el)?.focus(); });
    $("#gAth", el)?.addEventListener("change", (e) => { keep(); st.athlete = e.target.checked; draw(); });
    $("#gGoal", el)?.addEventListener("click", (e) => { const g = e.target.dataset.g; if (!g) return; keep(); st.goal = g; st.rate = GOALS[g][1]; draw(); });
    $("#gRate", el)?.addEventListener("input", () => { keep(); });
    $("#gA", el)?.addEventListener("input", () => {});
    el.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { st.preset = b.dataset.p; el.querySelectorAll("[data-p]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); }); });
    $("#gBack", el)?.addEventListener("click", () => { keep(); st.step--; draw(); });
    $("#gateForm", el).onsubmit = async (e) => {
      e.preventDefault();
      keep();
      const err = $("#gErr", el), go = $("#gGo", el);
      const pr = problem();
      err.textContent = pr;
      if (pr) return;
      if (st.step < 3) { st.step++; draw(); return; }
      const next = { ...profile, sex: st.sex || undefined, athlete: st.athlete || undefined };
      const all = profileProblem(next);
      if (all) { err.textContent = all; return; }
      go.disabled = true;
      try {
        await put("/api/me", { profile: next, settings: { goal: { type: st.goal, ratePctPerWeek: st.goal === "maintain" ? 0 : st.rate }, defaultPreset: st.preset } });
        // Seed the weight log too, so Trends starts from today instead of empty.
        await put(`/api/weights/${today()}`, { kg: next.weightKg }).catch(() => {});
        el.remove();
        document.body.classList.remove("gated");
        done();
      } catch (x) { err.textContent = x.message; go.disabled = false; toast(x.message); }
    };
    (el.querySelector("input:not([type=checkbox])") || $("#gGo", el))?.focus({ preventScroll: true });
  };
  draw();
}
