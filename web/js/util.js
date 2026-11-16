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

/** Drinks and other pourables are shown per 100 ml (1 ml ≈ 1 g for the maths). Display only. */
const LIQUID = /\b(beverage|drinks?|juice|milk|lassi|chaas|buttermilk|shakes?|smoothie|soda|cola|coffee|tea|chai|water|soup|broth|rasam|kombucha|beer|wine|whisky|vodka|rum)\b/i;
const SOLID = /\b(powder|chocolate|cake|bar|cookies?|biscuits?|bread|cheese|paneer|curd|yogurt|khoya|peda|barfi|leaves)\b/i;
export const isLiquid = (f) => !SOLID.test(f?.name || "") && (/beverage|drink/i.test(f?.category || "") || LIQUID.test(f?.name || ""));
export const unitOf = (f) => (isLiquid(f) ? "ml" : "g");

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
/** Downscale to fit `max` in halving steps (one big jump from a 12 MP photo aliases and looks soft).
 *  Takes an image or a canvas, returns a canvas, so smaller sizes can be derived from a larger one. */
export function scaleTo(src, max) {
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  const s = Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * s), h = Math.round(sh * s);
  let cur = src, cw = sw, ch = sh;
  const draw = (to, tw, th) => {
    const c = document.createElement("canvas"); c.width = tw; c.height = th;
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(to, 0, 0, tw, th);
    return c;
  };
  while (cw / 2 > w) { const next = draw(cur, Math.round(cw / 2), Math.round(ch / 2)); if (cur !== src) cur.width = 0; cur = next; cw = cur.width; ch = cur.height; }
  const out = draw(cur, w, h); if (cur !== src) cur.width = 0;
  return out;
}
export const resize = (img, max, q) => scaleTo(img, max).toDataURL("image/jpeg", q);

/** Replays the arrival animation on an element's children (CSS: .enter). */
export function enter(el) {
  if (!el) return;
  el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  clearTimeout(el._enter); el._enter = setTimeout(() => el.classList.remove("enter"), 1000);
}

export function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 19 ? "Snack" : "Dinner";
}
export const MEAL_TYPES = ["Breakfast", "Lunch", "Snack", "Dinner", "Pre-workout", "Post-workout"];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
