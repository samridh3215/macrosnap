export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const n0 = (v) => (v == null || isNaN(v) ? "–" : Math.round(v).toLocaleString("en-IN"));
export const n1 = (v) => (v == null || isNaN(v) ? "–" : (Math.round(v * 10) / 10).toLocaleString("en-IN"));
export const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

export const today = () => new Date().toLocaleDateString("en-CA");
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function prettyDate(date) {
  const t = today();
  if (date === t) return "Today";
  if (date === addDays(t, -1)) return "Yesterday";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function toast(msg, ms = 2400) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

export function openSheet(html, id = "sheet") {
  const dlg = $(`#${id}`); $(`#${id}Body`).innerHTML = html;
  if (!dlg.open) dlg.showModal();
  return $(`#${id}Body`);
}
export const closeSheet = (id = "sheet") => { const d = $(`#${id}`); if (d.open) d.close(); };

export function scale(per100g, grams) {
  const f = (Number(grams) || 0) / 100;
  return { kcal: Math.round(per100g.kcal * f), protein: r1(per100g.protein * f), carbs: r1(per100g.carbs * f), fat: r1(per100g.fat * f), fiber: r1(per100g.fiber * f) };
}
export function sum(list) {
  const t = list.reduce((a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat, fiber: a.fiber + m.fiber }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat), fiber: r1(t.fiber) };
}

/* ---------- images ---------- */
export async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1500); }
}
export function resize(img, max, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}

export function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 19 ? "Snack" : "Dinner";
}
export const MEAL_TYPES = ["Breakfast", "Lunch", "Snack", "Dinner", "Pre-workout", "Post-workout"];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
