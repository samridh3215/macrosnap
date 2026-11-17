import { get } from "./api.js";
import { openReview } from "./review.js";
import { $, closeSheet, esc, foodItem, ICONS, n0, openSheet, unitOf } from "./util.js";

/** The Log sheet: one place to start any kind of log. Photo and Label open the camera; Type and Library find a food. */
const MODES = [["photo", "Photo"], ["label", "Label"], ["type", "Type"], ["library", "Library"]];
let mode = "photo";

export function openLog({ date, onSaved, startCamera, startGallery }) {
  const body = openSheet(`<div id="lg"></div>`);
  const dlg = $("#sheet"); dlg.classList.add("logsheet");
  dlg.addEventListener("close", () => dlg.classList.remove("logsheet"), { once: true });
  let q = "", timer = null, foods = [], loaded = false;

  const review = (opts) => { closeSheet(); openReview({ date: date(), onSaved, ...opts }); };
  const pickFood = (f) => review({ mode: "manual", items: [foodItem(f)] });

  const draw = () => {
    const isPhoto = mode === "photo" || mode === "label", isLib = mode === "library";
    $("#lg", body).innerHTML = `
      <header class="lg-head"><h1>Log a meal</h1><button class="round" id="lgClose" aria-label="Close">${ICONS.close}</button></header>
      <div class="lg-tabs" role="tablist" aria-label="How to log">${MODES.map(([id, l]) => `<button role="tab" aria-selected="${mode === id}" data-m="${id}">${l}</button>`).join("")}</div>
      ${isPhoto ? `<div class="lg-pane">
          <button class="lg-drop" id="lgShoot">
            <span class="lg-disc">${mode === "label" ? ICONS.label : ICONS.camera}</span>
            <b>${mode === "label" ? "Photograph the label" : "Take a photo of your plate"}</b>
            <span>${mode === "label" ? "Get the whole nutrition table in frame, including the per-100 g column." : "Keep the whole plate in frame. Each item is named and weighed for you to check."}</span>
          </button>
          <button class="lg-row" id="lgGallery">${ICONS.gallery}Choose from gallery</button>
          <p class="lg-fine">You can also share a photo to this app from your gallery.</p>
        </div>` : `<div class="lg-pane">
          <label class="lg-lab" for="lgQ">${isLib ? "Search your library" : "What did you eat?"}</label>
          <div class="lg-search">${ICONS.search}<input id="lgQ" type="search" autocomplete="off" enterkeyhint="search" value="${esc(q)}" placeholder="${isLib ? "Search your library" : "e.g. paneer tikka, 2 rotis"}"></div>
          <p class="lg-cap" id="lgCap"></p>
          <ul class="list" id="lgList"></ul>
          ${!isLib ? `<button class="lg-create" id="lgCreate" ${q.trim() ? "" : "hidden"}>${ICONS.plus}<span>Create “<b></b>” as a new food</span></button>` : ""}
          <button class="btn xs ghost" id="lgManual">or enter your own numbers</button>
        </div>`}`;
    bind();
    if (!isPhoto) { paintList(); $("#lgQ", body).focus({ preventScroll: true }); if (!loaded || q) fetchFoods(); }
  };

  const paintList = () => {
    const isLib = mode === "library", ul = $("#lgList", body); if (!ul) return;
    const shown = (isLib && !q ? foods.slice().sort((a, b) => b.hits - a.hits) : foods).slice(0, 8);
    $("#lgCap", body).textContent = !loaded ? "" : isLib ? (q ? "Matches" : "Recent") : (shown.length ? "From your library" : "");
    ul.hidden = !shown.length;
    ul.innerHTML = shown.map((f) => `<li><button class="li tap lg-food" data-key="${esc(f.key)}">
      <span class="grow"><span class="name">${esc(f.name)}</span>
        <span class="sub num">${isLib ? `${f.unit ? `Usually 1 ${esc(f.unit.name)} · ` : ""}logged ${f.hits} time${f.hits === 1 ? "" : "s"}` : `per 100 ${unitOf(f)} · P ${n0(f.per100g.protein)} · C ${n0(f.per100g.carbs)} · F ${n0(f.per100g.fat)}`}</span></span>
      <span class="lg-k num">${n0(f.per100g.kcal)}</span></button></li>`).join("");
    ul.querySelectorAll(".lg-food").forEach((b) => b.onclick = () => pickFood(foods.find((f) => f.key === b.dataset.key)));
    const cr = $("#lgCreate", body);
    if (cr) { cr.hidden = !q.trim(); cr.querySelector("b").textContent = q.trim(); }
  };

  const fetchFoods = async () => {
    try { foods = await get(`/api/foods${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); } catch { foods = []; }
    loaded = true; paintList();
  };

  const bind = () => {
    const root = $("#lg", body);
    $("#lgClose", root).onclick = () => closeSheet();
    root.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => { mode = b.dataset.m; q = ""; loaded = false; foods = []; draw(); });
    $("#lgShoot", root)?.addEventListener("click", () => { closeSheet(); startCamera(); });
    $("#lgGallery", root)?.addEventListener("click", () => { closeSheet(); startGallery(); });
    $("#lgQ", root)?.addEventListener("input", (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(fetchFoods, 220); const cr = $("#lgCreate", root); if (cr) { cr.hidden = !q.trim(); cr.querySelector("b").textContent = q.trim(); } });
    $("#lgCreate", root)?.addEventListener("click", () => review({ mode: "describe", note: q.trim() }));
    $("#lgManual", root)?.addEventListener("click", () => review({ mode: "manual" }));
  };
  draw();
}
