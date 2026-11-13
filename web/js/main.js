import { renderFoods } from "./foods.js";
import { openCamera } from "./camera.js";
import { openReview } from "./review.js";
import { renderSettings } from "./settings.js";
import { dayState, renderToday } from "./today.js";
import { renderTrends } from "./trends.js";
import { $, toast } from "./util.js";

const view = $("#view");
const routes = { today: renderToday, foods: renderFoods, trends: renderTrends, settings: renderSettings };

function route() {
  const [path, qs] = (location.hash.replace(/^#\/?/, "") || "today").split("?");
  const name = routes[path] ? path : "today";
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
  const params = new URLSearchParams(qs || "");
  routes[name](view, params);
  if (name === "today" && params.get("add") === "photo") { history.replaceState(null, "", "#/today"); startPhoto(); }
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
handleShared().catch(() => {});
