import { $, closeSheet, openSheet, toast } from "./util.js";

/**
 * In-app camera: live viewfinder in a sheet, shutter button, and a gallery fallback.
 * Calls onPhoto(blob) with a JPEG. Falls back to the native file picker if the camera
 * is unavailable (no HTTPS, no permission, no device).
 */
export async function openCamera({ onPhoto, onPickFile }) {
  if (!navigator.mediaDevices?.getUserMedia) return onPickFile();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
  } catch {
    toast("Camera not available, pick a photo instead");
    return onPickFile();
  }

  const body = openSheet(`<h3>Snap your plate</h3>
    <video id="camVideo" class="cam-video" autoplay playsinline muted></video>
    <div class="foot">
      <button class="btn ghost" id="camGallery">Gallery</button>
      <span class="grow"></span>
      <button class="btn ghost" id="camCancel">Cancel</button>
      <button class="btn primary" id="camShoot">Take photo</button>
    </div>`, "modal");

  const video = $("#camVideo", body);
  video.srcObject = stream;

  const stop = () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  $("#modal").addEventListener("close", stop, { once: true });

  $("#camCancel", body).onclick = () => closeSheet("modal");
  $("#camGallery", body).onclick = () => { closeSheet("modal"); onPickFile(); };
  $("#camShoot", body).onclick = () => {
    if (!video.videoWidth) return toast("Camera is still starting");
    const c = document.createElement("canvas");
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    c.toBlob((blob) => {
      closeSheet("modal");
      if (blob) onPhoto(blob); else toast("Could not capture photo");
    }, "image/jpeg", 0.92);
  };
}
