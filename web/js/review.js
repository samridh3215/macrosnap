import { del, get, post } from "./api.js";
import { openFoodEditor } from "./foods.js";
import { $, blobToImage, closeSheet, esc, guessMeal, MEAL_TYPES, n0, n1, openSheet, r1, resize, scale, sum, toast, uid } from "./util.js";

/**
 * The meal review sheet: analysis results with per-item provenance, inline rename (which teaches
 * the food library), grams editing, fuzzy-match confirmation, breakdown inspection and manual items.
 */
let S = null;
let body = null;

const BADGE = {
  exact: ["b-cache", "From your library"], alias: ["b-cache", "From your library"], new: ["b-new", "Worked out just now"],
  manual: ["b-manual", "Your numbers"], fuzzy: ["b-fuzzy", "Close match"],
};

export async function openReview({ blob = null, note = "", mode = "photo", meal = null, date, onSaved }) {
  S = {
    mode: meal ? meal.source : mode, mealId: meal?.id ?? null, ts: meal?.ts, date: meal?.date ?? date, onSaved,
    items: meal ? structuredClone(meal.items) : mode === "manual" ? [manualItem()] : [],
    name: meal?.name ?? "", mealType: meal?.mealType ?? guessMeal(), note: meal?.note ?? note,
    image: null, hero: meal?.thumb ?? null, thumb: meal?.thumb ?? null, busy: false, status: "", err: false, info: "",
  };
  body = openSheet(`<div id="rv"></div>`);
  render();
  if (blob) {
    try {
      const img = await blobToImage(blob);
      const full = resize(img, 1024, 0.82);
      S.image = full.split(",")[1]; S.hero = full; S.thumb = resize(img, 128, 0.6);
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

function setStatus(msg, err = false) { S.status = msg; S.err = err; const el = $("#rvStatus", body); if (el) { el.innerHTML = msg; el.classList.toggle("err", err); } }

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

function itemHtml(it) {
  const [cls, label] = BADGE[it.match.type] ?? BADGE.manual;
  const fuzzyLabel = it.match.type === "fuzzy" ? (it.match.auto ? `Close match to ${it.match.candidateName}` : "Check this") : label;
  const t = it.totals;
  return `<div class="item" data-id="${it.id}">
    <div class="top">
      <input class="nm inline" data-act="rename" value="${esc(it.name)}" placeholder="Food name" />
      <input class="g inline" data-act="grams" type="number" inputmode="decimal" min="0" value="${it.grams || ""}" placeholder="g" /><span class="small muted">g</span>
      <button class="x" data-act="rm" aria-label="Remove">×</button>
    </div>
    <div class="meta">
      <span class="num">${n0(t.kcal)} kcal &nbsp;<span class="m-p">${n1(t.protein)}p</span> <span class="m-c">${n1(t.carbs)}c</span> <span class="m-f">${n1(t.fat)}f</span></span>
      <span>${esc(it.portion || "")}</span>
    </div>
    ${it.seenName && it.seenName.toLowerCase() !== it.name.toLowerCase() ? `<div class="tiny muted">Looked like “${esc(it.seenName)}”</div>` : ""}
    ${it.match.type === "fuzzy" && !it.match.auto ? `<div class="suggest"><span>Is this the same as <b>${esc(it.match.candidateName)}</b>?</span>
      <span class="row"><button class="btn xs" data-act="yes">Same</button><button class="btn xs" data-act="no">Different food</button></span></div>` : ""}
    ${it.match.type === "manual" ? `<div class="manual grid4">
      ${["kcal", "protein", "carbs", "fat"].map((k) => `<label class="tiny muted">${k === "kcal" ? "kcal" : k[0].toUpperCase() + " g"}<input class="inline" data-act="mac" data-k="${k}" type="number" inputmode="decimal" step="any" min="0" value="${t[k] || ""}"></label>`).join("")}
      </div>${it.name && it.grams ? `<div class="row" style="margin-top:6px"><button class="btn xs" data-act="savelib">Save to library</button><span class="tiny muted">Reused next time you log it</span></div>` : ""}` : ""}
    ${it.key ? `<details data-act="detail"><summary><span class="badge ${cls}">${fuzzyLabel}</span>${it.isAddon ? ` <span class="badge b-manual">Extra</span>` : ""} &nbsp;How this was worked out</summary><div class="detail" data-detail>Loading…</div></details>`
      : `<div style="margin-top:6px"><span class="badge ${cls}">${fuzzyLabel}</span>${it.isAddon ? ` <span class="badge b-manual">Extra</span>` : ""}</div>`}
  </div>`;
}

function render() {
  const t = sum(S.items.map((i) => i.totals));
  const root = $("#rv", body);
  root.innerHTML = `
    <h3>${S.mealId ? "Edit meal" : S.mode === "manual" ? "Enter a meal" : S.mode === "describe" ? "Describe your meal" : "Check your plate"}</h3>
    ${S.hero ? `<img class="hero" src="${S.hero}" alt="">` : ""}
    ${S.mode !== "manual" ? `<div class="row"><textarea id="rvNote" rows="${S.mode === "describe" ? 3 : 1}" placeholder="${S.mode === "describe" ? "e.g. 2 aloo parathas with curd, chai with sugar" : "Anything the photo misses? Extra ghee, 2 rotis, less oil"}">${esc(S.note)}</textarea>
      <button class="btn sm" id="rvAnalyze">${S.items.length ? "Look again" : "Work it out"}</button></div>` : ""}
    <div class="status ${S.err ? "err" : ""}" id="rvStatus">${S.status}</div>
    ${S.info ? `<div class="tiny muted" style="margin:-2px 0 8px">${esc(S.info)}</div>` : ""}

    <div id="rvItems">${S.items.map(itemHtml).join("")}</div>
    <div class="row" style="margin:12px 0 4px">
      <input id="rvAddName" class="inline grow" placeholder="Add something, like papad" />
      <input id="rvAddG" class="inline" style="width:68px" type="number" inputmode="decimal" placeholder="g" />
      <button class="btn sm" id="rvAdd">Add</button>
    </div>
    <button class="btn xs ghost" id="rvCustom" style="padding-left:0;color:var(--neel)">Enter your own numbers instead</button>

    <div class="totals">
      <div><b>${n0(t.kcal)}</b><span>kcal</span></div><div><b>${n1(t.protein)}</b><span>protein</span></div>
      <div><b>${n1(t.carbs)}</b><span>carbs</span></div><div><b>${n1(t.fat)}</b><span>fat</span></div><div><b>${n1(t.fiber)}</b><span>fiber</span></div>
    </div>
    <div class="grid2">
      <label class="f">Meal name<input id="rvName" value="${esc(S.name)}" placeholder="e.g. Dal chawal"></label>
      <label class="f">Meal<select id="rvType">${MEAL_TYPES.map((m) => `<option ${m === S.mealType ? "selected" : ""}>${m}</option>`).join("")}</select></label>
    </div>
    <div class="foot">
      ${S.mealId ? `<button class="btn ghost danger" id="rvDelete">Delete</button>` : ""}
      <span class="grow"></span>
      <button class="btn ghost" id="rvCancel" data-keep="1">Cancel</button>
      <button class="btn primary" id="rvSave">Log meal</button>
    </div>`;
  if (S.busy) { lock(true); setStatus(S.status); }
  bind(root);
}

function refreshTotalsOnly() {
  const t = sum(S.items.map((i) => i.totals));
  const el = $(".totals", body);
  if (el) el.innerHTML = `<div><b>${n0(t.kcal)}</b><span>kcal</span></div><div><b>${n1(t.protein)}</b><span>protein</span></div><div><b>${n1(t.carbs)}</b><span>carbs</span></div><div><b>${n1(t.fat)}</b><span>fat</span></div><div><b>${n1(t.fiber)}</b><span>fiber</span></div>`;
}

async function resolveInto(idx, payload, busyText) {
  const row = body.querySelector(`.item[data-id="${S.items[idx].id}"]`);
  row?.querySelector(".meta span")?.insertAdjacentHTML("afterbegin", `<span class="spin"></span>`);
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
  $("#rvCancel", root).onclick = () => closeSheet();
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
      const g = Number(e.target.value) || 0;
      if (it.per100g) it.totals = scale(it.per100g, g);
      else if (it.grams > 0 && g > 0) { const f = g / it.grams; it.totals = { kcal: Math.round(it.totals.kcal * f), protein: r1(it.totals.protein * f), carbs: r1(it.totals.carbs * f), fat: r1(it.totals.fat * f), fiber: r1(it.totals.fiber * f) }; }
      it.grams = g;
      const meta = row.querySelector(".meta .num");
      if (meta) meta.innerHTML = `${n0(it.totals.kcal)} kcal &nbsp;<span class="m-p">${n1(it.totals.protein)}p</span> <span class="m-c">${n1(it.totals.carbs)}c</span> <span class="m-f">${n1(it.totals.fat)}f</span>`;
      refreshTotalsOnly();
    } else if (act === "mac") {
      it.totals[e.target.dataset.k] = Number(e.target.value) || 0;
      refreshTotalsOnly();
    }
  });
  $("#rvItems", root).addEventListener("click", async (e) => {
    const row = e.target.closest(".item"); if (!row) return;
    const idx = S.items.findIndex((i) => i.id === row.dataset.id); const it = S.items[idx];
    const act = e.target.dataset.act;
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
  root.querySelectorAll("details[data-act=detail]").forEach((d) => d.addEventListener("toggle", async () => {
    if (!d.open || d.dataset.loaded) return;
    d.dataset.loaded = "1";
    const it = S.items.find((i) => i.id === d.closest(".item").dataset.id);
    const box = d.querySelector("[data-detail]");
    try {
      const f = await get(`/api/foods/${encodeURIComponent(it.key)}`);
      box.innerHTML = `${f.verified ? `<span class="badge b-ver">verified</span> ` : ""}${f.validation.ok ? "" : `<span class="badge b-warn">check: ${esc(f.validation.issues[0])}</span>`}
        <div class="muted" style="margin:4px 0">Per 100 g: ${n0(f.per100g.kcal)} kcal · P ${n1(f.per100g.protein)} · C ${n1(f.per100g.carbs)} · F ${n1(f.per100g.fat)} · fiber ${n1(f.per100g.fiber)}${f.unit ? ` · 1 ${esc(f.unit.name)} ≈ ${n0(f.unit.grams)} g` : ""}</div>
        ${f.ingredients.length ? `<table class="ing"><tr><td class="muted">Ingredient / 100 g</td><td>g</td><td>kcal</td></tr>${f.ingredients.map((x) => `<tr><td>${esc(x.name)}</td><td>${n1(x.grams)}</td><td>${n0(x.kcal)}</td></tr>`).join("")}</table>` : ""}
        <div class="muted">${esc(f.assumptions)}</div>
        <div class="tiny muted" style="margin-top:4px">${f.references.map(esc).join(" · ")} · ${esc(f.source.model || f.source.kind)}</div>
        <button class="btn xs" style="margin-top:6px" data-edit-food>Edit in library</button>`;
      box.querySelector("[data-edit-food]").onclick = () => openFoodEditor(f.key, async (updated) => {
        if (updated) { const i = S.items.indexOf(it); S.items[i] = { ...it, key: updated.key, name: updated.name, per100g: updated.per100g, totals: scale(updated.per100g, it.grams) }; render(); }
      });
    } catch (err) { box.textContent = err.message; }
  }));

  $("#rvSave", root).onclick = save;
  $("#rvDelete", root)?.addEventListener("click", async () => {
    if (!confirm("Delete this meal?")) return;
    await del(`/api/meals/${S.mealId}`); closeSheet(); toast("Deleted"); S.onSaved?.();
  });
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
