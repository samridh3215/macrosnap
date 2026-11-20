import { $, closeSheet, openSheet, toast } from "./util.js";

const BACK = /back|rear|environment/i, ULTRA = /ultra|0\.5/i, TELE = /tele|zoom/i;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const open = (deviceId) => navigator.mediaDevices.getUserMedia({
  video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }), width: { ideal: 1920 }, height: { ideal: 1440 } },
  audio: false,
});

/**
 * In-app camera: live viewfinder in a sheet, shutter button, and a gallery fallback.
 * Phones expose lenses in different ways and none of it can be detected reliably, so:
 *  - every back lens gets its own button (named 0.5x or tele when the phone says so, else Lens 1, 2, 3);
 *  - the lens you pick is remembered and used next time;
 *  - 1x / 2x zoom: the lens's own zoom when it has one, otherwise a centre crop.
 * Calls onPhoto(blob) with a JPEG. Falls back to the native file picker if the camera
 * is unavailable (no HTTPS, no permission, no device).
 */
export async function openCamera({ onPhoto, onPickFile, onNative }) {
  if (!navigator.mediaDevices?.getUserMedia) return onPickFile();

  let stream;
  try { stream = await open(); } catch {
    toast("Camera not available, pick a photo instead");
    return onPickFile();
  }

  // Labels only exist once permission is granted.
  let lenses = [];
  try {
    lenses = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput" && BACK.test(d.label))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
      .map((d, i) => ({ id: d.deviceId, label: d.label, name: ULTRA.test(d.label) ? "0.5×" : TELE.test(d.label) ? "Tele" : `Lens ${i + 1}` }));
  } catch { /* single default camera */ }

  const track = () => stream.getVideoTracks()[0];
  const current = () => track().getSettings().deviceId;
  const zoomCap = () => track().getCapabilities?.().zoom || null;
  let digital = 1, zoom = 1;

  const body = openSheet(`<h3>Snap your plate</h3>
    <div class="cam-wrap"><video id="camVideo" class="cam-video" autoplay playsinline muted></video>
      <div class="cam-zoom" role="group" aria-label="Zoom" id="camZoom"></div></div>
    <div class="cam-lenses" id="camLenses" role="group" aria-label="Lens"></div>
    <p class="tiny muted cam-info" id="camInfo"></p>
    ${onNative ? `<button class="btn tonal wide" id="camNative" style="margin-bottom:10px">Use my phone's camera app (its own 0.5× / 1× / 2×)</button>` : ""}
    <div class="foot">
      <button class="btn ghost" id="camGallery">Gallery</button>
      <span class="grow"></span>
      <button class="btn ghost" id="camCancel">Cancel</button>
      <button class="btn primary" id="camShoot">Take photo</button>
    </div>`, "modal");
  const video = $("#camVideo", body);
  video.srcObject = stream;

  async function applyZoom(z) {
    zoom = z; digital = 1;
    const r = zoomCap();
    if (r) await track().applyConstraints({ advanced: [{ zoom: Math.min(r.max, Math.max(r.min, z)) }] }).catch(() => {});
    if (!r || r.max < z) digital = z; // no lens zoom that far: crop the centre instead
    if (r && r.min > z) digital = 1;
    video.style.transform = digital > 1 ? `scale(${digital})` : "";
    paint();
  }

  async function useLens(id, remember = true) {
    if (id && id !== current()) {
      try { const next = await open(id); stream.getTracks().forEach((t) => t.stop()); stream = next; video.srcObject = stream; }
      catch { toast("That lens isn't available"); return; }
    }
    if (remember && id) store.set("camLens", lenses.find((l) => l.id === id)?.label || "");
    await applyZoom(1);
  }

  function paint() {
    const r = zoomCap();
    const levels = [...(r && r.min <= 0.55 ? [0.5] : []), 1, 2];
    $("#camZoom", body).innerHTML = levels.map((l) => `<button type="button" class="${l === zoom ? "on" : ""}" data-z="${l}" aria-pressed="${l === zoom}">${l === 0.5 ? ".5" : l}×</button>`).join("");
    $("#camZoom", body).querySelectorAll("button").forEach((b) => b.onclick = () => applyZoom(Number(b.dataset.z)));
    $("#camLenses", body).innerHTML = lenses.length > 1
      ? lenses.map((l) => `<button type="button" class="${l.id === current() ? "on" : ""}" data-l="${l.id}" aria-pressed="${l.id === current()}">${l.name}</button>`).join("") : "";
    $("#camLenses", body).querySelectorAll("button").forEach((b) => b.onclick = () => useLens(b.dataset.l));
    $("#camInfo", body).textContent = lenses.length > 1 ? "Pick the lens that looks right. It is remembered." : "";
  }

  const stop = () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  $("#modal").addEventListener("close", stop, { once: true });

  // Reopen on the lens you picked last time; the very first time, keep what the phone chose.
  const want = lenses.find((l) => l.label === store.get("camLens"));
  await useLens(want?.id || null, false);
  video.addEventListener("loadedmetadata", () => applyZoom(zoom), { once: true });

  $("#camNative", body) && ($("#camNative", body).onclick = () => { closeSheet("modal"); onNative(); });
  $("#camCancel", body).onclick = () => closeSheet("modal");
  $("#camGallery", body).onclick = () => { closeSheet("modal"); onPickFile(); };
  $("#camShoot", body).onclick = () => {
    if (!video.videoWidth) return toast("Camera is still starting");
    const W = video.videoWidth, H = video.videoHeight, sw = W / digital, sh = H / digital;
    const c = document.createElement("canvas");
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext("2d").drawImage(video, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      closeSheet("modal");
      if (blob) onPhoto(blob); else toast("Could not capture photo");
    }, "image/jpeg", 0.92);
  };
  // Shown only if the phone reports lenses, to help when a name isn't recognised.
  console.info("[camera]", lenses.map((l) => l.label), zoomCap());
}
