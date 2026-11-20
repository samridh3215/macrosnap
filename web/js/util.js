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
const SOLID = /\b(chestnuts?|singhara|melon|spinach|cress|flour|oil|ghee|mayonnaise|powder|chocolate|cake|bar|cookies?|biscuits?|bread|cheese|paneer|curd|yogurt|khoya|peda|barfi|leaves)\b/i;
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

/** Average weigh-in for the last 7 days (ending `to`) and the 7 before that. Null when there are none. */
export function weekAverages(series, to) {
  const day = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() - n); return x.toLocaleDateString("en-CA"); };
  const c1 = day(to, 7), c2 = day(to, 14);
  const avg = (a) => (a.length ? a.reduce((t, x) => t + x.weight, 0) / a.length : null);
  const w = series.filter((x) => x.weight != null);
  const cur = w.filter((x) => x.date > c1 && x.date <= to), prev = w.filter((x) => x.date > c2 && x.date <= c1);
  return { cur: avg(cur), curN: cur.length, prev: avg(prev), prevN: prev.length };
}

/* ---------- images ---------- */
export async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1500); }
}
/** Decodes a photo already shrunk to ~1600 px wide. A full-resolution camera photo (50-200 MP) can
 *  take hundreds of MB to decode, which makes low-memory phones kill the page, so shrink while decoding. */
export async function photoToImage(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob, { resizeWidth: 1600, resizeQuality: "medium" }); } catch {}
  }
  return blobToImage(blob);
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

/** A library food as a review-sheet item: one piece (or 100 g/ml) to start. */
export function foodItem(f) {
  const grams = f.unit?.grams || 100, p = f.per100g;
  return { id: uid(), seenName: f.name, query: f.name, lookupKey: f.key, key: f.key, name: f.name,
    portion: f.unit ? `1 ${f.unit.name}` : `100 ${unitOf(f)}`, grams, isAddon: false, per100g: { ...p }, totals: scale(p, grams),
    match: { type: "exact" }, confidence: f.confidence || "medium" };
}
export const ICONS = {
  close: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  search: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>`,
  plus: `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>`,
  camera: `<svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  label: `<svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
  gallery: `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M4 16l5-5 4 4 3-3 4 4"/><circle cx="15.5" cy="9" r="1.5"/></svg>`,
  type: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14v12H5zM8 10h1M11 10h1M14 10h2M8 14h8"/></svg>`,
  plate: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/></svg>`,
  book: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.5-1 2 15.5-3.5 1z"/></svg>`,
  swap: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4L4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8"/></svg>`,
  trash: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>`,
  warn: `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>`,
  info: `<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
  chevR: `<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
  back: `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  more: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>`,
  bolt: `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/></svg>`,
  run: `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="4.5" r="1.5"/><path d="M8 21l3-6 3 2v4M6 12l3-4 4 1 3 4 3 1"/></svg>`,
};
