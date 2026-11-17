import { del, get, post, put } from "./api.js";
import { openReview } from "./review.js";
import { $, closeSheet, enter, esc, ICONS, n0, n1, openSheet, scale, toast, today, uid, unitOf } from "./util.js";

/** The shared food library (Capella-backed): browse, fix names, correct numbers, verify, recompute. */
let q = "";
let filter = "all";
let timer = null;
const SRC = { llm: ["vision", "Vision"], label: ["label", "Label"], user: ["manual", "Manual"] };
const FILTERS = [["all", "All"], ["vision", "Vision"], ["label", "Label"], ["manual", "Manual"]];
let all = [];

export async function renderFoods(root) {
  root.innerHTML = `<header class="page-head"><div><h1>Library</h1><p class="head-sub num" id="fCount">&nbsp;</p></div><button class="btn tonal" id="fAdd">${ICONS.plus}Add food</button></header>
    <div class="searchbar">${ICONS.search}<input id="fq" type="search" placeholder="Search foods and aliases" aria-label="Search foods and aliases" value="${esc(q)}" /></div>
    <div class="filters" role="group" aria-label="Filter by source">${FILTERS.map(([id, l]) => `<button data-f="${id}" aria-pressed="${filter === id}" class="${filter === id ? "on" : ""}">${l}</button>`).join("")}</div>
    <p class="small muted" style="margin:14px 2px 12px">Each food is worked out once per 100 g, then reused for any portion. Fix a number here and every future log uses it.</p>
    <ul class="foodlist" id="flist"><li class="sk sk-row"></li><li class="sk sk-row"></li><li class="sk sk-row"></li></ul>`;
  $("#fAdd", root).onclick = () => openFoodCreator(q, () => load(root));
  $("#fq", root).oninput = (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(() => load(root), 250); };
  $(".filters", root).onclick = (e) => {
    const f = e.target.dataset.f; if (!f) return; filter = f;
    root.querySelectorAll(".filters button").forEach((b) => { const on = b.dataset.f === f; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    paint(root);
  };
  await load(root);
}

async function load(root) {
  const list = $("#flist", root);
  try {
    all = await get(`/api/foods${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    paint(root);
    if (!list.dataset.seen) { list.dataset.seen = "1"; enter(list); }
  } catch (e) { list.innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
}

function paint(root) {
  const list = $("#flist", root);
  const foods = all.filter((f) => filter === "all" || (SRC[f.source?.kind]?.[0] ?? "vision") === filter);
  $("#fCount", root).textContent = `${all.length} food${all.length === 1 ? "" : "s"} · values per 100 g`;
  list.innerHTML = foods.length ? foods.map((f) => {
    const [, srcLabel] = SRC[f.source?.kind] ?? SRC.llm;
    const note = f.source?.kind === "label" ? "From label" : f.source?.kind === "user" ? "Edited by you" : `Logged ${f.hits}×`;
    return `<li><button class="food" data-key="${esc(f.key)}">
      <span class="food-top"><span class="name">${esc(f.name)}</span><span class="kc num">${n0(f.per100g.kcal)}<small> kcal</small></span></span>
      <span class="food-tags"><span class="tag">${srcLabel}</span>${(f.aliases || []).slice(0, 3).map((a) => `<span class="tag alias">${esc(a)}</span>`).join("")}${f.verified ? `<span class="tag ok">verified</span>` : ""}${!f.ok ? `<span class="tag warn">check</span>` : ""}${f.confidence === "low" ? `<span class="tag warn">low confidence</span>` : ""}</span>
      <span class="food-foot num"><span>P ${n1(f.per100g.protein)} · C ${n1(f.per100g.carbs)} · F ${n1(f.per100g.fat)} · Fibre ${n1(f.per100g.fiber)}${f.unit ? ` · 1 ${esc(f.unit.name)} = ${n0(f.unit.grams)} ${unitOf(f)}` : ""}</span><span>${note}</span></span></button></li>`;
  }).join("") : `<li class="empty-card"><span class="disc">${ICONS.book}</span><b>${q || filter !== "all" ? "No matches" : "Your library starts empty"}</b><p>${q || filter !== "all" ? "Try another search or filter." : "Every food you log lands here with its values per 100 g, ready to reuse."}</p>${q || filter !== "all" ? "" : `<button class="btn tonal" id="fFirst">Log your first meal</button>`}</li>`;
  list.querySelectorAll("[data-key]").forEach((b) => b.onclick = () => openFoodEditor(b.dataset.key, () => load(root)));
  $("#fFirst", list)?.addEventListener("click", () => $("#logFab").click());
}

const X = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export async function openFoodEditor(key, onDone) {
  const dlg = $("#modal");
  const body = openSheet(`<div class="empty"><span class="spin"></span>Loading…</div>`, "modal");
  let f;
  try { f = await get(`/api/foods/${encodeURIComponent(key)}`); } catch (e) { body.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const p = f.per100g, u = unitOf(f);
  let recipe = f.ingredients.map((x) => ({ name: x.name, grams: x.grams }));
  let recipeDirty = false;

  dlg.classList.add("rvsheet");
  dlg.addEventListener("close", () => dlg.classList.remove("rvsheet"), { once: true });

  const rowHtml = (x, i) => `<div class="ing-row" data-i="${i}">
      <input class="inline" data-r="name" value="${esc(x.name)}" placeholder="Ingredient" aria-label="Ingredient name">
      <label class="gram"><input class="inline" data-r="grams" type="number" inputmode="decimal" min="0" step="any" value="${x.grams || ""}" placeholder="0" aria-label="Grams"><span>g</span></label>
      <button class="x" data-r="rm" aria-label="Remove ${esc(x.name)}">${X}</button>
    </div>`;

  body.innerHTML = `<div class="pane">
    <header class="sheet-head"><h3>${esc(f.name)}</h3><button class="icon-btn" id="feClose" aria-label="Close">${X}</button></header>
    <div class="sheet-scroll">
      <div class="fe-label">Per 100 ${u}</div>
      <div class="fe-macros">
        ${[["kcal", "kcal", p.kcal, ""], ["protein", "Protein", p.protein, "m-p"], ["carbs", "Carbs", p.carbs, "m-c"], ["fat", "Fat", p.fat, "m-f"], ["fiber", "Fiber", p.fiber, ""]]
          .map(([k, l, v, c]) => `<label class="${c}"><span>${l}</span><input class="inline" data-k="${k}" type="number" step="any" min="0" value="${v}"></label>`).join("")}
      </div>
      <div id="feCheck" class="small fe-check"></div>

      <div class="fe-label">Recipe <span class="tiny">grams per 100 ${u} of the finished dish</span></div>
      <div id="feRecipe">${recipe.map(rowHtml).join("") || `<p class="tiny muted">No recipe stored. Add ingredients and recompute.</p>`}</div>
      <button class="btn xs ghost fe-addrow" id="feAddRow">+ Add ingredient</button>
      <input id="feNote" class="fe-note" placeholder="Anything else? e.g. fried in 2 tsp ghee">
      <button class="btn fe-recompute" id="feRe">Recompute from this recipe</button>

      <details class="fe-more"><summary>How this was worked out</summary>
        <p class="small muted">${esc(f.assumptions || "No notes.")}</p>
        <p class="tiny muted">${f.references.map(esc).join(" · ")}</p>
        <p class="tiny muted">Source: ${esc(f.source.model || f.source.kind)} · v${f.version} · used ${f.hits}× · updated ${new Date(f.updatedAt).toLocaleDateString()}</p>
      </details>
      <details class="fe-more"><summary>More options</summary>
        <label class="f"><span>Name <span class="tiny">(renaming re-keys the entry; if it matches another food they merge)</span></span><input id="feName" value="${esc(f.name)}"></label>
        <div class="tiny muted" style="margin:-4px 0 12px">Key: <code>${esc(f.key)}</code>${f.aliases.length ? ` · also known as ${f.aliases.map(esc).join(", ")}` : ""}${f.linkedAliases?.length ? ` · ${f.linkedAliases.filter((a) => !a.rejected).length} linked names` : ""}</div>
        <div class="grid2">
          <label class="f">Category<input id="feCat" value="${esc(f.category)}"></label>
          <span></span>
          <label class="f">Piece name<input id="feUnitName" value="${esc(f.unit?.name ?? "")}" placeholder="e.g. roti"></label>
          <label class="f">Piece ${u === "ml" ? "volume (ml)" : "weight (g)"}<input id="feUnitG" type="number" min="0" value="${f.unit?.grams ?? ""}"></label>
        </div>
        <label class="row small"><input type="checkbox" id="feVer" ${f.verified ? "checked" : ""}> Verified: lock these numbers (never recomputed automatically)</label>
        <button class="btn ghost danger sm fe-del" id="feDel">Delete this food</button>
      </details>
    </div>
    <footer class="sheet-foot"><div class="foot"><button class="btn grow" id="feLog">Log it</button><button class="btn primary grow" id="feSave">Save</button></div></footer>
  </div>`;

  const read = () => Object.fromEntries([...body.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, Number(i.value) || 0]));
  const check = () => {
    const v = read(), at = 4 * v.protein + 4 * v.carbs + 9 * v.fat + 2 * v.fiber;
    const ok = Math.abs(v.kcal - at) <= Math.max(20, 0.12 * v.kcal);
    $("#feCheck", body).innerHTML = ok ? `<span class="badge b-cache">✓ adds up</span> <span class="muted">macros → ${n0(at)} kcal</span>`
      : `<span class="badge b-warn">doesn't add up</span> <span class="muted">macros imply ${n0(at)} kcal, entered ${n0(v.kcal)}</span>`;
  };
  body.querySelectorAll("[data-k]").forEach((i) => (i.oninput = check)); check();

  // recipe editing
  const list = $("#feRecipe", body);
  list.addEventListener("input", (e) => {
    const row = e.target.closest(".ing-row"); if (!row) return;
    const it = recipe[Number(row.dataset.i)];
    if (e.target.dataset.r === "name") it.name = e.target.value; else it.grams = Number(e.target.value) || 0;
    recipeDirty = true;
  });
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-r=rm]"); if (!btn) return;
    recipe.splice(Number(btn.closest(".ing-row").dataset.i), 1); recipeDirty = true; redrawRecipe();
  });
  const redrawRecipe = () => { list.innerHTML = recipe.map(rowHtml).join("") || `<p class="tiny muted">No ingredients. Add some, then recompute.</p>`; };
  $("#feAddRow", body).onclick = () => {
    recipe.push({ name: "", grams: 0 }); recipeDirty = true; redrawRecipe();
    list.querySelector(".ing-row:last-child input")?.focus();
  };

  $("#feClose", body).onclick = () => closeSheet("modal");
  // Log this food as a meal: opens the usual meal sheet with it filled in, one piece (or 100 g) to start.
  $("#feLog", body).onclick = () => {
    const v = read();
    if (["kcal", "protein", "carbs", "fat", "fiber"].some((k) => Number(v[k]) !== Number(p[k]))) return toast("Save your changes first, then log it");
    const grams = f.unit?.grams || 100;
    const item = { id: uid(), seenName: f.name, query: f.name, lookupKey: f.key, key: f.key, name: f.name,
      portion: f.unit ? `1 ${f.unit.name}` : `100 ${u}`, grams, isAddon: false, per100g: { ...p }, totals: scale(p, grams),
      match: { type: "exact" }, confidence: f.confidence || "medium" };
    closeSheet("modal");
    openReview({ mode: "manual", items: [item], date: today(), onSaved: () => onDone?.(f) });
  };
  $("#feSave", body).onclick = async () => {
    if (recipeDirty && !confirm("You edited the recipe but haven't recomputed. Those edits won't be saved. Save anyway?")) return;
    const v = read();
    const changed = ["kcal", "protein", "carbs", "fat", "fiber"].some((k) => Number(v[k]) !== Number(p[k]));
    const unitName = $("#feUnitName", body).value.trim(), unitG = Number($("#feUnitG", body).value);
    const name = $("#feName", body).value.trim();
    try {
      const r = await put(`/api/foods/${encodeURIComponent(f.key)}`, {
        name: name && name !== f.name ? name : undefined,
        per100g: changed ? v : undefined,
        unit: unitName && unitG > 0 ? { name: unitName, grams: unitG } : null,
        category: $("#feCat", body).value.trim() || undefined,
        verified: $("#feVer", body).checked,
      });
      toast(r.merged ? `Merged into ${r.food.name}` : "Saved");
      closeSheet("modal"); onDone?.(r.food);
    } catch (e) { toast(e.message); }
  };
  $("#feRe", body).onclick = async (e) => {
    const force = f.verified ? confirm("This food is verified. Recompute anyway (it becomes unverified)?") : true;
    if (!force) return;
    const rows = recipe.filter((x) => x.name.trim() && x.grams > 0).map((x) => ({ name: x.name.trim(), grams: x.grams }));
    e.target.disabled = true; e.target.innerHTML = `<span class="spin"></span>Working it out…`;
    try {
      const nf = await post(`/api/foods/${encodeURIComponent(f.key)}/recompute`, { force: f.verified, recipe: rows.length ? rows : undefined, note: $("#feNote", body).value.trim() || undefined });
      toast(rows.length ? "Recomputed from your recipe" : "Recomputed");
      onDone?.(nf);
      closeSheet("modal"); openFoodEditor(nf.key, onDone);
    } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Recompute from this recipe"; }
  };
  $("#feDel", body).onclick = async () => {
    if (!confirm(`Delete ${f.name} from the library? Past meals keep their numbers.`)) return;
    await del(`/api/foods/${encodeURIComponent(f.key)}`); toast("Deleted"); closeSheet("modal"); onDone?.(null);
  };
}

/**
 * Add a food to the library: type the numbers from a label (saved as yours, verified),
 * or give just the name and let the model work it out once per 100 g (same path as logging an unknown item).
 */
export function openFoodCreator(name = "", onDone) {
  const dlg = $("#modal");
  const body = openSheet(`<div class="pane">
    <header class="sheet-head"><h3>Add a food</h3><button class="icon-btn" id="fcClose" aria-label="Close">${X}</button></header>
    <div class="sheet-scroll">
      <label class="f">Name<input id="fcName" value="${esc(name)}" placeholder="e.g. Whey protein powder" autocomplete="off"></label>
      <div class="fe-label">Per 100 <span class="fcU">g</span></div>
      <p class="tiny muted" style="margin:-4px 2px 10px">Copy them from the label, or leave them blank and tap Work it out.</p>
      <div class="fe-macros">
        ${[["kcal", "kcal", ""], ["protein", "Protein", "m-p"], ["carbs", "Carbs", "m-c"], ["fat", "Fat", "m-f"], ["fiber", "Fiber", ""]]
          .map(([k, l, c]) => `<label class="${c}"><span>${l}</span><input class="inline" data-k="${k}" type="number" inputmode="decimal" step="any" min="0" placeholder="0"></label>`).join("")}
      </div>
      <div id="fcCheck" class="small fe-check"></div>
      <div class="fe-label" style="margin-top:18px">Piece <span class="tiny">optional, so you can log "1 scoop"</span></div>
      <div class="grid2">
        <label class="f">Piece name<input id="fcUnitName" placeholder="e.g. scoop"></label>
        <label class="f">Piece <span class="fcUW">weight (g)</span><input id="fcUnitG" type="number" inputmode="decimal" min="0" placeholder="e.g. 30"></label>
      </div>
      <p class="gate-err small" id="fcErr" role="alert"></p>
    </div>
    <footer class="sheet-foot"><div class="foot"><button class="btn grow" id="fcAuto">Work it out</button><button class="btn primary grow" id="fcSave">Add food</button></div></footer>
  </div>`, "modal");
  dlg.classList.add("rvsheet");
  dlg.addEventListener("close", () => dlg.classList.remove("rvsheet"), { once: true });

  const err = $("#fcErr", body);
  const nameOf = () => $("#fcName", body).value.trim();
  const read = () => Object.fromEntries([...body.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, i.value === "" ? null : Number(i.value)]));
  const unit = () => {
    const n = $("#fcUnitName", body).value.trim(), g = Number($("#fcUnitG", body).value);
    return n && g > 0 ? { name: n, grams: g } : null;
  };
  const check = () => {
    const v = read();
    if (v.kcal == null) { $("#fcCheck", body).innerHTML = ""; return; }
    const at = 4 * (v.protein || 0) + 4 * (v.carbs || 0) + 9 * (v.fat || 0) + 2 * (v.fiber || 0);
    const ok = Math.abs(v.kcal - at) <= Math.max(20, 0.12 * v.kcal);
    $("#fcCheck", body).innerHTML = ok ? `<span class="badge b-cache">✓ adds up</span> <span class="muted">macros → ${n0(at)} kcal</span>`
      : `<span class="badge b-warn">doesn't add up</span> <span class="muted">macros imply ${n0(at)} kcal, entered ${n0(v.kcal)}</span>`;
  };
  body.querySelectorAll("[data-k]").forEach((i) => (i.oninput = check));
  const syncUnit = () => { const u = unitOf({ name: nameOf() }); body.querySelector(".fcU").textContent = u; body.querySelector(".fcUW").textContent = u === "ml" ? "volume (ml)" : "weight (g)"; };
  $("#fcName", body).addEventListener("input", syncUnit); syncUnit();
  const done = (key) => { closeSheet("modal"); onDone?.(); if (key) openFoodEditor(key, onDone); };
  /** Same name already in the library? Ask before replacing its numbers. */
  const clash = async (n) => (await get(`/api/foods?q=${encodeURIComponent(n)}`)).find((f) => f.name.toLowerCase() === n.toLowerCase());

  $("#fcClose", body).onclick = () => closeSheet("modal");
  $("#fcSave", body).onclick = async (e) => {
    const n = nameOf(), v = read();
    err.textContent = !n ? "Enter a name" : v.kcal == null ? `Enter at least kcal per 100 ${unitOf({ name: n })}, or tap Work it out` : "";
    if (err.textContent) return;
    const per100g = { kcal: v.kcal, protein: v.protein || 0, carbs: v.carbs || 0, fat: v.fat || 0, fiber: v.fiber || 0 };
    e.target.disabled = true;
    try {
      const old = await clash(n);
      if (old && !confirm(`${old.name} is already in your library. Replace its numbers with these?`)) { e.target.disabled = false; return; }
      await post("/api/foods", { name: n, per100g, unit: unit() });
      toast(`${n} added`);
      done(null);
    } catch (x) { err.textContent = x.message; e.target.disabled = false; }
  };
  $("#fcAuto", body).onclick = async (e) => {
    const n = nameOf();
    err.textContent = n ? "" : "Enter a name first";
    if (!n) return;
    const btn = e.target.closest("button");
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span>Working it out…`;
    try {
      const r = await post("/api/resolve", { name: n, grams: 100 });
      const key = r.item.key;
      const u = unit();
      if (u && key) await put(`/api/foods/${encodeURIComponent(key)}`, { unit: u });
      toast(r.item.match.type === "new" ? `${r.item.name} worked out and added` : `Already in your library as ${r.item.name}`);
      done(key);
    } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = "Work it out"; }
  };
  $("#fcName", body).focus();
}
