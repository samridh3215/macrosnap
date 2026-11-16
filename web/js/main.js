import { renderFoods } from "./foods.js";
import { openCamera } from "./camera.js";
import { ensureProfile } from "./onboarding.js";
import { openReview } from "./review.js";
import { renderSettings } from "./settings.js";
import { dayState, renderToday } from "./today.js";
import { renderTrends } from "./trends.js";
import { $, toast } from "./util.js";

const view = $("#view");

/** Sheets close by dragging the header or grab handle down, or by tapping the dimmed area. */
function sheetGestures(dlg) {
  let y0 = null, dy = 0, t0 = 0;
  const reset = () => { dlg.style.transition = ""; dlg.style.transform = ""; };
  dlg.addEventListener("touchstart", (e) => {
    const y = e.touches[0].clientY;
    if (y - dlg.getBoundingClientRect().top > 64 && !e.target.closest(".sheet-head")) return;
    y0 = y; dy = 0; t0 = Date.now(); dlg.style.transition = "none";
  }, { passive: true });
  dlg.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    dlg.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const end = () => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
    y0 = null;
    dlg.style.transition = "transform .2s cubic-bezier(.23, 1, .32, 1)";
    if (dy > 110 || (fast && dy > 60)) {
      dlg.style.transform = "translateY(100%)";
      setTimeout(() => { dlg.close(); reset(); }, 190);
    } else { dlg.style.transform = ""; setTimeout(reset, 220); }
  };
  dlg.addEventListener("touchend", end);
  dlg.addEventListener("touchcancel", end);
  dlg.addEventListener("click", (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) dlg.close();
  });
}
document.querySelectorAll("dialog.sheet").forEach(sheetGestures);
const routes = { today: renderToday, foods: renderFoods, trends: renderTrends, settings: renderSettings };

function route() {
  const [path, qs] = (location.hash.replace(/^#\/?/, "") || "today").split("?");
  const name = routes[path] ? path : "today";
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
  const params = new URLSearchParams(qs || "");
  routes[name](view, params);
  const add = name === "today" && params.get("add");
  if (add) history.replaceState(null, "", "#/today");
  if (add === "photo") startPhoto();
  else if (add === "manual") openReview({ mode: "manual", date: dayState.date, onSaved: refreshToday });
}
window.addEventListener("hashchange", route);

const refreshToday = () => { if ((location.hash || "#/today").startsWith("#/today")) renderToday(view); };

export function startPhoto() {
  openCamera({
    onPhoto: (blob) => openReview({ blob, mode: "photo", date: dayState.date, onSaved: refreshToday }),
    onPickFile: () => $("#photoInput").click(),
  });
}
window.addEventListener("macrosnap:photo", startPhoto);
$("#snapFab").onclick = startPhoto;

$("#photoInput").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) openReview({ blob: f, mode: "photo", date: dayState.date, onSaved: refreshToday });
};

/** Photo shared from the gallery: the service worker stashed it in the "shared" cache. */
async function handleShared() {
  const p = new URLSearchParams(location.search);
  if (p.has("share_failed")) toast("Open the app once, then share again");
  if (!p.has("shared") && !p.has("share_failed")) return;
  history.replaceState(null, "", "/" + (location.hash || "#/today"));
  if (!p.has("shared")) return;
  const cache = await caches.open("shared");
  const [img, txt] = await Promise.all([cache.match("/shared-image"), cache.match("/shared-text")]);
  await Promise.all([cache.delete("/shared-image"), cache.delete("/shared-text")]);
  const note = txt ? await txt.text() : "";
  if (img) openReview({ blob: await img.blob(), note, mode: "photo", date: dayState.date, onSaved: refreshToday });
  else if (note) openReview({ mode: "describe", note, date: dayState.date, onSaved: refreshToday });
}

if ("serviceWorker" in navigator) {
  // When a new version takes over, reload once so the open app never runs old files.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
// Nothing renders until the body profile is complete; shared photos wait behind it too.
ensureProfile().catch(() => {}).then(() => { route(); handleShared().catch(() => {}); });
