import { $, closeSheet, openSheet, toast } from "./util.js";

const LEVELS = [0.5, 1, 2];
const BACK = /back|rear|environment/i, ULTRA = /ultra|0\.5/i;
const saved = () => { try { return Number(localStorage.getItem("camZoom")) || 1; } catch { return 1; } };
const remember = (z) => { try { localStorage.setItem("camZoom", String(z)); } catch { /* private mode */ } };

const open = (deviceId) => navigator.mediaDevices.getUserMedia({
  video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }), width: { ideal: 1920 }, height: { ideal: 1440 } },
  audio: false,
});

/**
 * In-app camera: live viewfinder in a sheet, shutter button, and a gallery fallback.
 * Starts on the main lens at 1x (never the ultra-wide) with 0.5x / 1x / 2x buttons.
 * Phones expose lenses differently, so each level uses whatever the phone offers:
 * the lens zoom when it has one, a separate ultra-wide camera for 0.5x, otherwise a centre crop for 2x.
 * Calls onPhoto(blob) with a JPEG. Falls back to the native file picker if the camera
 * is unavailable (no HTTPS, no permission, no device).
 */
export async function openCamera({ onPhoto, onPickFile }) {
  if (!navigator.mediaDevices?.getUserMedia) return onPickFile();

  let stream;
  try { stream = await open(); } catch {
    toast("Camera not available, pick a photo instead");
    return onPickFile();
  }

  // Labels only exist once permission is granted, so look at the lenses now.
  let main = null, ultra = null;
  try {
    const backs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput" && BACK.test(d.label));
    ultra = backs.find((d) => ULTRA.test(d.label))?.deviceId || null;
    main = backs.find((d) => !ULTRA.test(d.label))?.deviceId || null;
  } catch { /* keep defaults */ }

  const track = () => stream.getVideoTracks()[0];
  const deviceOf = () => track().getSettings().deviceId;
  const switchTo = async (deviceId) => {
    if (!deviceId || deviceId === deviceOf()) return;
    try { const next = await open(deviceId); stream.getTracks().forEach((t) => t.stop()); stream = next; video.srcObject = stream; } catch { /* stay on the current lens */ }
  };
  const zoomCap = () => track().getCapabilities?.().zoom || null;

  const body = openSheet(`<h3>Snap your plate</h3>
    <div class="cam-wrap"><video id="camVideo" class="cam-video" autoplay playsinline muted></video>
      <div class="cam-zoom" role="group" aria-label="Zoom" id="camZoom"></div></div>
    <div class="foot">
      <button class="btn ghost" id="camGallery">Gallery</button>
      <span class="grow"></span>
      <button class="btn ghost" id="camCancel">Cancel</button>
      <button class="btn primary" id="camShoot">Take photo</button>
    </div>`, "modal");

  const video = $("#camVideo", body);
  video.srcObject = stream;
  let digital = 1, level = 1;

  const hwRange = () => { const z = zoomCap(); return z ? [z.min, z.max] : null; };
  const available = () => LEVELS.filter((l) => l === 1 || l === 2 || (l === 0.5 && ((hwRange() && hwRange()[0] <= 0.55) || ultra)));

  async function setLevel(l) {
    level = l; digital = 1;
    if (l === 0.5) {
      const r = hwRange();
      if (r && r[0] <= 0.55) await track().applyConstraints({ advanced: [{ zoom: Math.max(r[0], 0.5) }] }).catch(() => {});
      else if (ultra) await switchTo(ultra);
    } else {
      // Never stay on the ultra-wide for 1x or 2x.
      if (main && (ULTRA.test(track().label) || deviceOf() === ultra)) await switchTo(main);
      const r = hwRange();
      if (r) await track().applyConstraints({ advanced: [{ zoom: Math.min(r[1], Math.max(r[0], l)) }] }).catch(() => {});
      if (l === 2 && !(r && r[1] >= 2)) digital = 2;
      if (l === 1 && r && r[0] > 1) digital = 1;
    }
    video.style.transform = digital > 1 ? `scale(${digital})` : "";
    paint(); remember(l);
  }

  function paint() {
    $("#camZoom", body).innerHTML = available().map((l) => `<button type="button" class="${l === level ? "on" : ""}" data-z="${l}" aria-pressed="${l === level}">${l === 0.5 ? ".5" : l}×</button>`).join("");
    $("#camZoom", body).querySelectorAll("button").forEach((b) => b.onclick = () => setLevel(Number(b.dataset.z)));
  }

  const stop = () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  $("#modal").addEventListener("close", stop, { once: true });

  // Start on the main lens at the last level used, but never the ultra-wide unless asked for.
  const want = saved();
  if (main && (ULTRA.test(track().label) || deviceOf() === ultra)) await switchTo(main);
  paint();
  setLevel(available().includes(want) ? want : 1);

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
}
