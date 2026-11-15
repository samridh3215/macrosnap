import { del, get, post, put } from "./api.js";
import { $, closeSheet, enter, esc, n0, n1, openSheet, toast } from "./util.js";

/** The shared food library (Capella-backed): browse, fix names, correct numbers, verify, recompute. */
let q = "";
let timer = null;

export async function renderFoods(root) {
  root.innerHTML = `<h1>Your foods</h1>
    <input id="fq" type="search" placeholder="Search your foods" aria-label="Search your foods" value="${esc(q)}" />
    <p class="small muted" style="margin:10px 2px 16px">Each food is worked out once per 100 g, then reused for any portion. Fix a number here and every future log uses it.</p>
    <ul class="list" id="flist"><li class="empty"><span class="spin"></span>Loading…</li></ul>`;
  $("#fq", root).oninput = (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(() => load(root), 250); };
  await load(root);
}

async function load(root) {
  const list = $("#flist", root);
  try {
    const foods = await get(`/api/foods${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    list.innerHTML = foods.length ? foods.map((f) => `<li class="li tap" data-key="${esc(f.key)}">
      <div class="grow"><div class="name">${esc(f.name)}${f.verified ? ` <span class="badge b-ver">verified</span>` : ""}${!f.ok ? ` <span class="badge b-warn">check</span>` : ""}${f.confidence === "low" ? ` <span class="badge b-fuzzy">low confidence</span>` : ""}</div>
        <div class="sub"><span class="m-p">${n1(f.per100g.protein)}p</span> <span class="m-c">${n1(f.per100g.carbs)}c</span> <span class="m-f">${n1(f.per100g.fat)}f</span>${f.unit ? ` · 1 ${esc(f.unit.name)} = ${n0(f.unit.grams)} g` : ""} · logged ${f.hits}×</div></div>
      <div class="kcal">${n0(f.per100g.kcal)}<small>per 100 g</small></div></li>`).join("")
      : `<li class="empty">${q ? "No matches." : "Nothing here yet. Foods appear as you log meals."}</li>`;
    list.querySelectorAll("[data-key]").forEach((li) => li.onclick = () => openFoodEditor(li.dataset.key, () => load(root)));
    if (!list.dataset.seen) { list.dataset.seen = "1"; enter(list); }
  } catch (e) { list.innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
}

const X = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export async function openFoodEditor(key, onDone) {
  const dlg = $("#modal");
  const body = openSheet(`<div class="empty"><span class="spin"></span>Loading…</div>`, "modal");
  let f;
  try { f = await get(`/api/foods/${encodeURIComponent(key)}`); } catch (e) { body.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const p = f.per100g;
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
      <div class="fe-label">Per 100 g</div>
      <div class="fe-macros">
        ${[["kcal", "kcal", p.kcal, ""], ["protein", "Protein", p.protein, "m-p"], ["carbs", "Carbs", p.carbs, "m-c"], ["fat", "Fat", p.fat, "m-f"], ["fiber", "Fiber", p.fiber, ""]]
          .map(([k, l, v, c]) => `<label class="${c}"><span>${l}</span><input class="inline" data-k="${k}" type="number" step="any" min="0" value="${v}"></label>`).join("")}
      </div>
      <div id="feCheck" class="small fe-check"></div>

      <div class="fe-label">Recipe <span class="tiny">grams per 100 g of the finished dish</span></div>
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
          <label class="f">Piece weight (g)<input id="feUnitG" type="number" min="0" value="${f.unit?.grams ?? ""}"></label>
        </div>
        <label class="row small"><input type="checkbox" id="feVer" ${f.verified ? "checked" : ""}> Verified: lock these numbers (never recomputed automatically)</label>
        <button class="btn ghost danger sm fe-del" id="feDel">Delete this food</button>
      </details>
    </div>
    <footer class="sheet-foot"><div class="foot"><button class="btn primary grow" id="feSave">Save</button></div></footer>
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
