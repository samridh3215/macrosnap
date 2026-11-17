import { del, get, post } from "./api.js";
import { openFoodEditor } from "./foods.js";
import { dayState } from "./today.js";
import { $, blobToImage, closeSheet, esc, guessMeal, ICONS, MEAL_TYPES, n0, n1, openSheet, r1, scale, scaleTo, sum, toast, uid } from "./util.js";

/**
 * The meal review sheet: analysis results with per-item provenance, inline rename (which teaches
 * the food library), grams editing, fuzzy-match confirmation, breakdown inspection and manual items.
 */
let S = null;
let body = null;

const CLOSE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const INFO = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.4" r=".6" fill="currentColor"/></svg>`;
const CHEV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>`;
/* Where an item's numbers came from: badge class, long label, short label for the row mark, mark tone. */
const BADGE = {
  exact: ["b-cache", "From your library", "Library", "t-lib"], alias: ["b-cache", "From your library", "Library", "t-lib"],
  new: ["b-new", "Worked out just now", "New", "t-new"], label: ["b-cache", "Read from the label", "Label", "t-lib"], manual: ["b-manual", "Your numbers", "Yours", "t-own"], fuzzy: ["b-fuzzy", "Close match", "Check", "t-check"],
};
const ORIGIN = {
  exact: "Found in your food library, so no new estimate was needed.",
  alias: "Found in your food library under another name you taught it.",
  new: "Not in your library yet. It was worked out once per 100 g and saved for next time.",
  manual: "You entered these numbers yourself.",
  label: "Read from the nutrition label in your photo, so these are the printed numbers, not an estimate. Saved to your library for next time.",
};

export async function openReview({ blob = null, note = "", mode = "photo", meal = null, items = null, date, onSaved }) {
  S = {
    mode: meal ? meal.source : mode, mealId: meal?.id ?? null, ts: meal?.ts, date: meal?.date ?? date, onSaved,
    items: meal ? structuredClone(meal.items) : items ? items : mode === "manual" ? [manualItem()] : [],
    name: meal?.name ?? "", mealType: meal?.mealType ?? guessMeal(), note: meal?.note ?? note,
    baseKcal: dayState.data && (meal?.date ?? date) === dayState.date ? dayState.data.totals.kcal - (meal ? meal.totals.kcal : 0) : null,
    target: dayState.data?.targets?.target ?? null, clock: meal?.ts ? new Date(meal.ts) : new Date(),
    image: null, hero: meal?.thumb ?? null, thumb: meal?.thumb ?? null, busy: false, status: "", err: false, info: "",
  };
  S.lowres = false;
  if (meal?.thumb) { // meals saved before the larger thumbnail are small: show them small, never stretched
    const im = new Image(); im.src = meal.thumb;
    await im.decode().catch(() => {}); S.lowres = im.naturalWidth > 0 && im.naturalWidth < 400;
  }
  body = openSheet(`<div id="rv" class="pane"></div>`);
  const dlg = $("#sheet"); dlg.classList.add("rvsheet");
  dlg.addEventListener("close", () => dlg.classList.remove("rvsheet"), { once: true });
  render();
  if (blob) {
    try {
      const img = await blobToImage(blob);
      const big = scaleTo(img, 1280);                        // one pass over the full-size photo; smaller copies come from it
      S.hero = big.toDataURL("image/jpeg", 0.86);            // what you see: sharp at full sheet width
      S.image = scaleTo(big, 1024).toDataURL("image/jpeg", 0.82).split(",")[1];  // what the vision model sees
      S.thumb = scaleTo(big, 640).toDataURL("image/jpeg", 0.8);                  // what is saved: crisp in lists and when reopened
      big.width = 0;
      render();
      await analyze();
    } catch { setStatus("Couldn't read that image.", true); }
  } else if (mode === "describe" && note) {
    await analyze();
  }
}

function manualItem() {
  return { id: uid(), seenName: "", query: "", lookupKey: "", key: "", name: "", portion: "", grams: 0, isAddon: false, per100g: null,
    totals: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, match: { type: "manual" }, confidence: "medium" };
}

function setStatus(msg, err = false) { S.status = msg; S.err = err; const el = $("#rvStatus", body); if (el) { el.innerHTML = msg; el.classList.toggle("err", err); el.classList.toggle("hidden", !msg); } }

async function analyze() {
  const note = ($("#rvNote", body)?.value ?? S.note).trim();
  S.note = note;
  if (!S.image && !note) return setStatus("Describe what you ate first.", true);
  S.busy = true; setStatus(`<span class="spin"></span>${S.image ? "Looking at your plate…" : "Reading what you ate…"}`);
  lock(true);
  try {
    const r = await post("/api/analyze", { image: S.image ?? undefined, note });
    S.items = r.items; S.name = r.mealName;
        const parts = [`${r.stats.cacheHits} from your library`, r.stats.computed ? `${r.stats.computed} worked out by ${short(r.models.reasoning)}` : "", r.stats.suggestions ? `${r.stats.suggestions} to check` : ""].filter(Boolean);
    S.info = `Spotted by ${short(r.models.vision)}. ${parts.join(", ")}. Cost $${(r.usage?.costUsd ?? 0).toFixed(4)}, ${(r.stats.ms / 1000).toFixed(1)}s.`;
    S.status = [r.notes, ...r.warnings].filter(Boolean).map(esc).join(" · "); S.err = r.warnings.length > 0;
    if (!r.items.length) { S.items = [manualItem()]; S.status = esc(r.notes || "No food found — add items manually."); S.err = true; }
  } catch (e) {
    S.status = `${esc(e.message)} — you can still add items manually.`; S.err = true;
    if (!S.items.length) S.items = [manualItem()];
  } finally { S.busy = false; render(); }
}
const short = (id) => (id || "").split("/").pop();

function lock(on) { body.querySelectorAll("button, input, select, textarea").forEach((x) => { if (!x.dataset.keep) x.disabled = on; }); }

const CONF = { high: ["var(--haldi)", "High confidence"], medium: ["var(--mirch)", "Medium confidence"], low: ["var(--accent-2)", "Low confidence"] };
const macroKcal = (t) => Math.round(4 * t.protein + 4 * t.carbs + 9 * t.fat);
const mismatch = (it) => it.totals.kcal > 0 && it.match.type !== "manual" && Math.abs(it.totals.kcal - macroKcal(it.totals)) > Math.max(25, 0.15 * it.totals.kcal);

function itemHtml(it) {
  const [cls, label, short, tone] = BADGE[it.match.type] ?? BADGE.manual;
  const t = it.match.type, fuzzy = t === "fuzzy";
  const origin = fuzzy ? (it.match.auto ? `Matched automatically to “${esc(it.match.candidateName)}” because the names are close.` : `The name is close to “${esc(it.match.candidateName)}”. Confirm it above so the right numbers are used.`) : ORIGIN[t] ?? ORIGIN.manual;
  const tot = it.totals, [dot, dotLabel] = CONF[it.confidence] ?? CONF.medium;
  return `<article class="item" data-id="${it.id}">
    <div class="it-top">
      <span class="dot" role="img" aria-label="${dotLabel}" title="${dotLabel}" style="background:${dot}"></span>
      <div class="it-id">
        <input class="nm inline" data-act="rename" value="${esc(it.name)}" placeholder="Food name" aria-label="Food name" enterkeyhint="done" />
        <button class="src ${tone}" data-act="info" aria-expanded="false" aria-label="Where this came from: ${label}">${label}${CHEV}</button>
      </div>
      <button class="ib" data-act="swap" aria-label="Swap ${esc(it.name)} for a library food">${ICONS.swap}</button>
      <button class="ib" data-act="rm" aria-label="Remove ${esc(it.name)}">${ICONS.trash}</button>
    </div>
    <div class="it-mid">
      <div class="stepper">
        <button data-act="dec" aria-label="Less ${esc(it.name)}">${ICONS.minus}</button>
        <label class="gram"><input class="g inline" data-act="grams" type="number" inputmode="decimal" min="0" value="${it.grams || ""}" placeholder="0" aria-label="Grams" /><span>g</span></label>
        <button data-act="inc" aria-label="More ${esc(it.name)}">${ICONS.plus}</button>
      </div>
      <div class="it-nums"><span class="kc num"><b>${n0(tot.kcal)}</b> kcal</span><span class="meta num">P ${n0(tot.protein)} · C ${n0(tot.carbs)} · F ${n0(tot.fat)}</span></div>
    </div>
    ${mismatch(it) ? warnHtml(it) : ""}
    ${fuzzy && !it.match.auto ? `<div class="suggest"><span>Is this the same as <b>${esc(it.match.candidateName)}</b>?</span>
      <span class="row"><button class="btn xs" data-act="yes">Same</button><button class="btn xs" data-act="no">Different food</button></span></div>` : ""}
    ${t === "manual" ? `<div class="manual grid4">
      ${["kcal", "protein", "carbs", "fat"].map((k) => `<label class="tiny muted">${k === "kcal" ? "kcal" : k[0].toUpperCase() + " g"}<input class="inline" data-act="mac" data-k="${k}" type="number" inputmode="decimal" step="any" min="0" value="${tot[k] || ""}"></label>`).join("")}
      </div>${it.name && it.grams ? `<div class="row" style="margin-top:6px"><button class="btn xs" data-act="savelib">Save to library</button><span class="tiny muted">Reused next time you log it</span></div>` : ""}` : ""}
    <div class="item-info" hidden>
      <div>
        <p class="ii-h">Where this came from</p>
        <p class="ii-line"><span class="badge ${cls}">${short}</span></p>
        <p class="ii-line">${origin}</p>
        ${it.seenName && it.seenName !== it.name ? `<p class="ii-line muted">In the photo it looked like “${esc(it.seenName)}”.</p>` : ""}
        ${it.portion ? `<p class="ii-line muted">Portion read as ${esc(it.portion)}.</p>` : ""}
        <div data-detail>${it.key ? `<span class="muted">Loading…</span>` : ""}</div>
      </div>
      <div>
        <p class="ii-h">If you change it</p>
        <ul class="ii-rules">
          <li><b>Grams</b> rescale this meal only.</li>
          <li><b>Name</b> looks up that food instead. Repeat the same fix and your library learns it.</li>
          ${it.key ? `<li><b>Edit in library</b> changes the numbers for every future log.</li>` : t === "manual" ? `<li><b>Save to library</b> reuses your numbers next time.</li>` : ""}
        </ul>
      </div>
    </div>
  </article>`;
}

const warnHtml = (it) => `<div class="warn" data-warn>${ICONS.warn}<span>Calories don't match the macros. They add up to ${n0(macroKcal(it.totals))} kcal.</span><button data-act="fixkcal">Use ${n0(macroKcal(it.totals))}</button></div>`;

/** Grams changed (typed or stepped): rescale this item and refresh just its numbers. */
function applyGrams(row, it, g) {
  if (it.per100g) it.totals = scale(it.per100g, g);
  else if (it.grams > 0 && g > 0) { const f = g / it.grams; it.totals = { kcal: Math.round(it.totals.kcal * f), protein: r1(it.totals.protein * f), carbs: r1(it.totals.carbs * f), fat: r1(it.totals.fat * f), fiber: r1(it.totals.fiber * f) }; }
  it.grams = g;
  paintItem(row, it);
}
function paintItem(row, it) {
  const kc = row.querySelector(".kc"), meta = row.querySelector(".meta");
  if (kc) kc.innerHTML = `<b>${n0(it.totals.kcal)}</b> kcal`;
  if (meta) meta.textContent = `P ${n0(it.totals.protein)} · C ${n0(it.totals.carbs)} · F ${n0(it.totals.fat)}`;
  const w = row.querySelector("[data-warn]");
  if (mismatch(it)) { if (w) w.outerHTML = warnHtml(it); else row.querySelector(".it-mid").insertAdjacentHTML("afterend", warnHtml(it)); }
  else w?.remove();
  refreshTotalsOnly();
}

function totalsHtml(t) {
  const left = S.baseKcal != null && S.target != null ? Math.round(S.target - S.baseKcal - t.kcal) : null;
  return `<span class="tk num">${n0(t.kcal)} kcal</span>
    <span class="tl num">${left == null ? `P ${n1(t.protein)} · C ${n1(t.carbs)} · F ${n1(t.fat)}` : left >= 0 ? `${n0(left)} kcal left to target after this` : `${n0(-left)} kcal over target after this`}</span>
    <span class="tm num">P ${n1(t.protein)} · C ${n1(t.carbs)} · F ${n1(t.fat)} · fibre ${n1(t.fiber)}</span>`;
}

function render() {
  const t = sum(S.items.map((i) => i.totals));
  const root = $("#rv", body);
  const clock = S.clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const n = S.items.length;
  root.innerHTML = `
    <header class="sheet-head rv-head" id="rvHead">
      ${S.hero ? `<button class="rv-thumb" id="rvPhotoBtn" data-keep="1" aria-label="${S.photoFull ? "Hide photo" : "Show photo"}"><img src="${S.thumb || S.hero}" alt="Photo of your meal" decoding="async"></button>` : ""}
      <div class="rv-title">
        <h1>${S.mealType} · ${clock}</h1>
        ${S.info ? `<button class="rv-how" id="rvAbout" data-keep="1">${n} item${n === 1 ? "" : "s"} · How was this estimated?${ICONS.chevR}</button>` : `<span class="rv-how">${n} item${n === 1 ? "" : "s"}${S.mealId ? " · Edit meal" : ""}</span>`}
      </div>
      <button class="round" id="rvClose" data-keep="1" aria-label="Close">${ICONS.close}</button>
    </header>
    <div class="sheet-scroll">
      ${S.hero && S.photoFull ? `<button class="rv-photo-btn full" id="rvPhotoFull" data-keep="1" aria-label="Shrink photo"><img class="rv-photo" src="${S.hero}" alt="Photo of your meal" decoding="async"></button>` : ""}
      ${S.info ? `<p class="rv-about" id="rvAboutBox" hidden>${esc(S.info)}</p>` : ""}
      ${S.mode === "describe" ? `<textarea id="rvNote" rows="3" placeholder="e.g. 2 aloo parathas with curd, chai with sugar">${esc(S.note)}</textarea>
        <button class="btn primary rv-go" id="rvAnalyze">${S.items.length ? "Look again" : "Work it out"}</button>` : ""}
      <div class="rv-id">
        <input id="rvName" value="${esc(S.name)}" placeholder="Name this meal" aria-label="Meal name">
        <select id="rvType" aria-label="Meal type">${MEAL_TYPES.map((m) => `<option ${m === S.mealType ? "selected" : ""}>${m}</option>`).join("")}</select>
      </div>
      ${S.mode === "photo" ? `<div class="rv-note"><input id="rvNote" type="text" enterkeyhint="done" placeholder="Add a note, e.g. extra ghee" value="${esc(S.note)}"><button class="btn xs" id="rvAnalyze">Update</button></div>` : ""}
      ${S.status ? `<div class="status ${S.err ? "err" : ""}" id="rvStatus">${S.status}</div>` : `<div id="rvStatus" class="status hidden"></div>`}

      <div id="rvItems">${S.items.map(itemHtml).join("")}</div>
      <div class="rv-add">
        <input id="rvAddName" class="inline grow" placeholder="Add an item" aria-label="Add an item" />
        <input id="rvAddG" class="inline" type="number" inputmode="decimal" placeholder="g" aria-label="Grams" />
        <button class="btn sm" id="rvAdd">Add</button>
      </div>
      <button class="rv-addcard" id="rvCustom">${ICONS.plus}Add an item with your own numbers</button>
    </div>
    <footer class="sheet-foot rv-foot">
      <div class="totals" id="rvTotals">${totalsHtml(t)}</div>
      <div class="foot">
        ${S.mealId ? `<button class="btn ghost danger" id="rvDelete">Delete</button>` : ""}
        <button class="btn primary" id="rvSave">${S.mealId ? "Save changes" : "Log meal"}</button>
      </div>
    </footer>`;
  if (S.busy) { lock(true); setStatus(S.status); }
  bind(root);
}

function refreshTotalsOnly() {
  const el = $("#rvTotals", body);
  if (el) el.innerHTML = totalsHtml(sum(S.items.map((i) => i.totals)));
}

async function resolveInto(idx, payload, busyText) {
  const row = body.querySelector(`.item[data-id="${S.items[idx].id}"]`);
  row?.querySelector(".kc")?.insertAdjacentHTML("afterbegin", `<span class="spin"></span>`);
  row?.querySelectorAll("input,button").forEach((x) => (x.disabled = true));
  if (busyText) setStatus(`<span class="spin"></span>${busyText}`);
  try {
    const r = await post("/api/resolve", payload);
    const oldName = S.items[idx].name;
    S.items[idx] = r.item;
    // Keep an auto-generated meal name in sync with renamed items.
    if (oldName && S.name.toLowerCase().includes(oldName.toLowerCase())) {
      S.name = S.name.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), r.item.name);
    }
    if (r.learned?.promoted) toast(`Learned: “${S.items[idx].seenName}” → ${r.item.name} from now on`);
    else if (r.item.match.type === "new") toast(`${r.item.name} computed and added to your library`);
    setStatus("");
  } catch (e) { setStatus(esc(e.message), true); }
  render();
}

function bind(root) {
  $("#rvAnalyze", root)?.addEventListener("click", analyze);
  $("#rvClose", root).onclick = () => closeSheet();
  $("#rvAbout", root)?.addEventListener("click", () => { const b = $("#rvAboutBox", root); b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ block: "nearest" }); });
  $("#rvPhotoBtn", root)?.addEventListener("click", () => { S.photoFull = !S.photoFull; render(); });
  $("#rvPhotoFull", root)?.addEventListener("click", () => { S.photoFull = false; render(); });
  $("#rvName", root).oninput = (e) => (S.name = e.target.value);
  $("#rvType", root).onchange = (e) => (S.mealType = e.target.value);
  $("#rvNote", root)?.addEventListener("input", (e) => (S.note = e.target.value));

  $("#rvAdd", root).onclick = async () => {
    const name = $("#rvAddName", root).value.trim();
    if (!name) return;
    const grams = Number($("#rvAddG", root).value) || undefined;
    S.items.push({ ...manualItem(), name, grams: grams || 0 });
    await resolveInto(S.items.length - 1, { name, grams }, `Looking up ${esc(name)}…`);
  };
  $("#rvCustom", root).onclick = () => { S.items.push(manualItem()); render(); };

  $("#rvItems", root).addEventListener("change", async (e) => {
    const row = e.target.closest(".item"); if (!row) return;
    const idx = S.items.findIndex((i) => i.id === row.dataset.id); const it = S.items[idx];
    const act = e.target.dataset.act;
    if (act === "rename") {
      const name = e.target.value.trim();
      if (!name || name === it.name) return;
      if (it.match.type === "manual" && !it.key) { it.name = name; it.query = name; render(); return; }
      // Rename → look the new name up (or compute it); the server learns from repeated corrections.
      await resolveInto(idx, { name, grams: it.grams, seenName: it.seenName, lookupKey: it.lookupKey || undefined, previousKey: it.key || undefined, portion: it.portion, isAddon: it.isAddon }, `Updating to ${esc(name)}…`);
    }
  });
  $("#rvItems", root).addEventListener("input", (e) => {
    const row = e.target.closest(".item"); if (!row) return;
    const it = S.items.find((i) => i.id === row.dataset.id);
    const act = e.target.dataset.act;
    if (act === "grams") {
      applyGrams(row, it, Number(e.target.value) || 0);
    } else if (act === "mac") {
      it.totals[e.target.dataset.k] = Number(e.target.value) || 0;
      paintItem(row, it);
    }
  });
  $("#rvItems", root).addEventListener("click", async (e) => {
    const row = e.target.closest(".item"); if (!row) return;
    const idx = S.items.findIndex((i) => i.id === row.dataset.id); const it = S.items[idx];
    const act = e.target.dataset.act;
    if (e.target.closest("[data-act=info]")) { toggleInfo(row, it); return; }
    if (e.target.closest("[data-act=rm]")) { const gone = S.items.splice(idx, 1)[0]; render(); toast(`Removed ${gone.name || "item"}`); return; }
    if (e.target.closest("[data-act=swap]")) { const nm = row.querySelector(".nm"); nm.focus(); nm.select(); toast("Type a library food name, then tap Done"); return; }
    const stepBtn = e.target.closest("[data-act=dec],[data-act=inc]");
    if (stepBtn) {
      const dir = stepBtn.dataset.act === "inc" ? 1 : -1, step = it.grams && it.grams < 50 ? 5 : 10;
      const g = Math.max(5, Math.min(1500, (Number(it.grams) || 0) + dir * step));
      applyGrams(row, it, g); row.querySelector("[data-act=grams]").value = g; return;
    }
    if (e.target.closest("[data-act=fixkcal]")) {
      const k = macroKcal(it.totals);
      if (it.per100g && it.grams) it.per100g = { ...it.per100g, kcal: Math.round(k * 100 / it.grams) };
      it.totals = { ...it.totals, kcal: k }; paintItem(row, it); return;
    }
    if (act === "rm") { S.items.splice(idx, 1); render(); }
    else if (act === "yes") await resolveInto(idx, { name: it.query || it.name, grams: it.grams, seenName: it.seenName, lookupKey: it.lookupKey, confirmKey: it.key, portion: it.portion, isAddon: it.isAddon });
    else if (act === "no") await resolveInto(idx, { name: it.query || it.seenName, grams: it.grams, seenName: it.seenName, rejectKey: it.key, portion: it.portion, isAddon: it.isAddon }, "Computing a new entry…");
    else if (act === "savelib") {
      const f = 100 / it.grams;
      try {
        const food = await post("/api/foods", { name: it.name, per100g: { kcal: it.totals.kcal * f, protein: it.totals.protein * f, carbs: it.totals.carbs * f, fat: it.totals.fat * f, fiber: it.totals.fiber * f } });
        Object.assign(it, { key: food.key, query: it.name, per100g: food.per100g, match: { type: "exact" } });
        toast(`${food.name} saved to your library`); render();
      } catch (err) { toast(err.message); }
    }
  });
  $("#rvSave", root).onclick = save;
  $("#rvDelete", root)?.addEventListener("click", async () => {
    if (!confirm("Delete this meal?")) return;
    await del(`/api/meals/${S.mealId}`); closeSheet(); toast("Deleted"); S.onSaved?.();
  });
}

async function toggleInfo(row, it) {
  const panel = row.querySelector(".item-info"), btn = row.querySelector("[data-act=info]");
  panel.hidden = !panel.hidden; btn.setAttribute("aria-expanded", String(!panel.hidden));
  if (panel.hidden || !it.key || panel.dataset.loaded) return;
  panel.dataset.loaded = "1";
  const box = panel.querySelector("[data-detail]");
  try {
    const f = await get(`/api/foods/${encodeURIComponent(it.key)}`);
    box.innerHTML = `<p class="ii-line ii-per num" style="margin-top:8px">Per 100 g: ${n0(f.per100g.kcal)} kcal · P ${n1(f.per100g.protein)} · C ${n1(f.per100g.carbs)} · F ${n1(f.per100g.fat)} · fiber ${n1(f.per100g.fiber)}${f.unit ? ` · 1 ${esc(f.unit.name)} ≈ ${n0(f.unit.grams)} g` : ""} ${f.verified ? `<span class="badge b-ver">verified</span>` : ""}${f.validation.ok ? "" : ` <span class="badge b-warn">check: ${esc(f.validation.issues[0])}</span>`}</p>
      ${f.ingredients.length ? `<table class="ing"><tr><td class="muted">Ingredient per 100 g</td><td>g</td><td>kcal</td></tr>${f.ingredients.map((x) => `<tr><td>${esc(x.name)}</td><td>${n1(x.grams)}</td><td>${n0(x.kcal)}</td></tr>`).join("")}</table>` : ""}
      <p class="ii-line muted tiny" style="margin-top:8px">${esc(f.assumptions)}</p>
      <p class="ii-line muted tiny">${f.references.map(esc).join(" · ")}${f.references.length ? " · " : ""}${esc(f.source.model || f.source.kind)}</p>
      <div class="ii-foot" style="margin-top:8px"><button class="btn xs" data-edit-food>Edit in library</button></div>`;
    box.querySelector("[data-edit-food]").onclick = () => openFoodEditor(f.key, async (updated) => {
      if (updated) { const i = S.items.indexOf(it); S.items[i] = { ...it, key: updated.key, name: updated.name, per100g: updated.per100g, totals: scale(updated.per100g, it.grams) }; render(); }
    });
  } catch { box.innerHTML = `<p class="ii-line muted" style="margin-top:8px">Library details aren't available for this item.</p>`; }
}

async function save() {
  const items = S.items.filter((i) => i.name.trim() || i.totals.kcal).map((i) => ({ ...i, name: i.name.trim() || "Item", grams: Number(i.grams) || 0 }));
  if (!items.length) return setStatus("Add at least one item.", true);
  const name = ($("#rvName", body).value || "").trim() || items.map((i) => i.name).slice(0, 3).join(", ");
  try {
    await post("/api/meals", {
      id: S.mealId ?? undefined, ts: S.ts, date: S.date, mealType: $("#rvType", body).value, name,
      note: S.note || "", source: S.mode, thumb: S.thumb, items,
    });
    closeSheet();
    toast(`Logged ${n0(sum(items.map((i) => i.totals)).kcal)} kcal`);
    S.onSaved?.();
  } catch (e) { setStatus(esc(e.message), true); }
}
