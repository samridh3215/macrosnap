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
 * Resolves once the profile has weight, height, age and sex. Shows a full-screen step until then.
 * If the server can't be reached (no token yet), it lets the app open so Settings can fix the connection.
 */
export async function ensureProfile() {
  let me;
  try { me = await get("/api/me"); } catch { return; }
  if (!me.profileMissing?.length) return;
  await new Promise((done) => showGate(me.profile, done));
}

function showGate(profile, done) {
  const sex = { v: profile.sex || "" };
  const el = document.createElement("section");
  el.className = "gate";
  el.setAttribute("aria-labelledby", "gateTitle");
  el.innerHTML = `<div class="gate-in">
    <div class="gate-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/><circle cx="8.5" cy="14.5" r="2.2"/><circle cx="15.5" cy="14.5" r="2.2"/><circle cx="12" cy="8.3" r="2.2"/></svg></div>
    <h1 id="gateTitle">Before you start</h1>
    <p class="gate-sub">Your daily targets are worked out from your body, so we need four numbers first. You can change them any time in Settings.</p>
    <form id="gateForm" novalidate>
      <div class="grid2">
        <label class="f">Weight (kg)<input id="gW" type="number" inputmode="decimal" step="0.1" autocomplete="off" value="${esc(profile.weightKg ?? "")}"></label>
        <label class="f">Height (cm)<input id="gH" type="number" inputmode="decimal" autocomplete="off" value="${esc(profile.heightCm ?? "")}"></label>
        <label class="f">Age<input id="gA" type="number" inputmode="numeric" autocomplete="off" value="${esc(profile.age ?? "")}"></label>
        <div class="f" role="group" aria-labelledby="gSexL"><span id="gSexL">Sex</span>
          <div class="seg" id="gSex"><button type="button" data-s="male" class="${sex.v === "male" ? "on" : ""}">Male</button><button type="button" data-s="female" class="${sex.v === "female" ? "on" : ""}">Female</button></div>
        </div>
      </div>
      <p class="gate-err small" id="gErr" role="alert"></p>
      <button class="btn primary" id="gGo" type="submit">Continue</button>
      <p class="tiny muted gate-fine">Used only to estimate your resting energy. Body fat and your goal are optional, in Settings.</p>
    </form>
  </div>`;
  document.body.append(el);
  document.body.classList.add("gated");
  enter(el);
  $("#gSex", el).onclick = (e) => {
    const s = e.target.dataset.s; if (!s) return;
    sex.v = s;
    el.querySelectorAll("#gSex button").forEach((b) => b.classList.toggle("on", b.dataset.s === s));
  };
  const num = (id) => { const v = $(id, el).value; return v === "" ? undefined : Number(v); };
  $("#gateForm", el).onsubmit = async (e) => {
    e.preventDefault();
    const next = { ...profile, weightKg: num("#gW"), heightCm: num("#gH"), age: num("#gA"), sex: sex.v || undefined };
    const err = $("#gErr", el), go = $("#gGo", el);
    const problem = profileProblem(next);
    err.textContent = problem;
    if (problem) return;
    go.disabled = true;
    try {
      await put("/api/me", { profile: next });
      // Seed the weight log too, so Trends starts from today instead of empty.
      await put(`/api/weights/${today()}`, { kg: next.weightKg }).catch(() => {});
      el.remove();
      document.body.classList.remove("gated");
      done();
    } catch (x) { err.textContent = x.message; go.disabled = false; toast(x.message); }
  };
  $("#gW", el).focus();
}
