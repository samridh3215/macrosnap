import { del, get, post, put } from "./api.js";
import { $, closeSheet, esc, n0, n1, openSheet, toast } from "./util.js";

/** The shared food library (Capella-backed): browse, fix names, correct numbers, verify, recompute. */
let q = "";
let timer = null;

export async function renderFoods(root) {
  root.innerHTML = `<h1>Your foods</h1>
    <input id="fq" placeholder="Search your foods" value="${esc(q)}" />
    <p class="small muted" style="margin:8px 2px 14px">Each food is worked out once per 100 g, then reused for any portion. Fix a number here and every future log uses it.</p>
    <ul class="list" id="flist"><li class="empty"><span class="spin"></span>Loading…</li></ul>`;
  $("#fq", root).oninput = (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(() => load(root), 250); };
  await load(root);
}

async function load(root) {
  const list = $("#flist", root);
  try {
    const foods = await get(`/api/foods${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    list.innerHTML = foods.length ? foods.map((f) => `<li class="li tap" data-key="${esc(f.key)}">
      <div class="grow"><div class="name">${esc(f.name)} ${f.verified ? `<span class="badge b-ver">verified</span>` : ""}${!f.ok ? ` <span class="badge b-warn">check</span>` : ""}${f.confidence === "low" ? ` <span class="badge b-fuzzy">low conf.</span>` : ""}</div>
        <div class="sub"><span class="m-p">${n1(f.per100g.protein)}p</span> <span class="m-c">${n1(f.per100g.carbs)}c</span> <span class="m-f">${n1(f.per100g.fat)}f</span> per 100 g${f.unit ? `, 1 ${esc(f.unit.name)} is ${n0(f.unit.grams)} g` : ""}. Logged ${f.hits}×.</div></div>
      <div class="kcal">${n0(f.per100g.kcal)}<small>per 100 g</small></div></li>`).join("")
      : `<li class="empty">${q ? "No matches." : "Nothing here yet. Foods appear as you log meals."}</li>`;
    list.querySelectorAll("[data-key]").forEach((li) => li.onclick = () => openFoodEditor(li.dataset.key, () => load(root)));
  } catch (e) { list.innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
}

export async function openFoodEditor(key, onDone) {
  const body = openSheet(`<div class="empty"><span class="spin"></span>Loading…</div>`, "modal");
  let f;
  try { f = await get(`/api/foods/${encodeURIComponent(key)}`); } catch (e) { body.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const p = f.per100g;
  body.innerHTML = `<h3>${esc(f.name)}</h3>
    <label class="f">Name <span class="tiny">(renaming re-keys the entry; if it matches another food they merge)</span><input id="feName" value="${esc(f.name)}"></label>
    <div class="tiny muted" style="margin:-4px 0 10px">Key: <code>${esc(f.key)}</code>${f.aliases.length ? ` · also known as ${f.aliases.map(esc).join(", ")}` : ""}
      ${f.linkedAliases?.length ? ` · ${f.linkedAliases.filter((a) => !a.rejected).length} linked names` : ""}</div>
    <div class="tiny muted">Per 100 g</div>
    <div class="grid4" style="margin:4px 0 10px">
      ${[["kcal", "kcal"], ["protein", "P g"], ["carbs", "C g"], ["fat", "F g"]].map(([k, l]) => `<label class="tiny muted">${l}<input class="inline" data-k="${k}" type="number" step="any" min="0" value="${p[k]}"></label>`).join("")}
    </div>
    <div class="grid2">
      <label class="f">Fiber g / 100 g<input class="inline" data-k="fiber" type="number" step="any" min="0" value="${p.fiber}"></label>
      <label class="f">Category<input id="feCat" value="${esc(f.category)}"></label>
      <label class="f">Piece name<input id="feUnitName" value="${esc(f.unit?.name ?? "")}" placeholder="e.g. roti"></label>
      <label class="f">Piece weight (g)<input id="feUnitG" type="number" min="0" value="${f.unit?.grams ?? ""}"></label>
    </div>
    <label class="row small"><input type="checkbox" id="feVer" ${f.verified ? "checked" : ""}> Verified — lock these numbers (never recomputed automatically)</label>
    <div id="feCheck" class="small" style="margin:8px 0"></div>
    ${f.ingredients.length ? `<details><summary>Recipe breakdown (${f.ingredients.length} ingredients)</summary><table class="ing">${f.ingredients.map((x) => `<tr><td>${esc(x.name)}</td><td>${n1(x.grams)} g</td><td>${n0(x.kcal)} kcal</td></tr>`).join("")}</table>
      <div class="small muted">${esc(f.assumptions)}</div><div class="tiny muted">${f.references.map(esc).join(" · ")}</div></details>` : ""}
    <div class="tiny muted" style="margin-top:8px">Source: ${esc(f.source.model || f.source.kind)} · v${f.version} · used ${f.hits}× · updated ${new Date(f.updatedAt).toLocaleDateString()}</div>
    <div class="foot">
      <button class="btn ghost danger sm" id="feDel">Delete</button>
      <button class="btn sm" id="feRe">Recompute</button>
      <span class="grow"></span>
      <button class="btn ghost" id="feClose">Close</button>
      <button class="btn primary" id="feSave">Save</button>
    </div>`;

  const read = () => Object.fromEntries([...body.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, Number(i.value) || 0]));
  const check = () => {
    const v = read(), at = 4 * v.protein + 4 * v.carbs + 9 * v.fat + 2 * v.fiber;
    const ok = Math.abs(v.kcal - at) <= Math.max(20, 0.12 * v.kcal);
    $("#feCheck", body).innerHTML = ok ? `<span class="badge b-cache">✓ adds up</span> <span class="muted">macros → ${n0(at)} kcal</span>`
      : `<span class="badge b-warn">doesn't add up</span> <span class="muted">macros imply ${n0(at)} kcal, entered ${n0(v.kcal)}</span>`;
  };
  body.querySelectorAll("[data-k]").forEach((i) => (i.oninput = check)); check();

  $("#feClose", body).onclick = () => closeSheet("modal");
  $("#feSave", body).onclick = async () => {
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
    e.target.disabled = true; e.target.innerHTML = `<span class="spin"></span>Thinking…`;
    try { const nf = await post(`/api/foods/${encodeURIComponent(f.key)}/recompute`, { force: f.verified }); toast("Recomputed"); closeSheet("modal"); onDone?.(nf); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Recompute"; }
  };
  $("#feDel", body).onclick = async () => {
    if (!confirm(`Delete ${f.name} from the library? Past meals keep their numbers.`)) return;
    await del(`/api/foods/${encodeURIComponent(f.key)}`); toast("Deleted"); closeSheet("modal"); onDone?.(null);
  };
}
