import { get, post } from "./api.js";
import { $, enter, esc, toast } from "./util.js";

const MARK = `<div class="gate-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/><circle cx="8.5" cy="14.5" r="2.2"/><circle cx="15.5" cy="14.5" r="2.2"/><circle cx="12" cy="8.3" r="2.2"/></svg></div>`;
const GOOGLE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`;

const SIGNIN_ERRORS = {
  expired: "That sign-in took too long. Try again.",
  cancelled: "Sign-in was cancelled.",
  failed: "Google sign-in failed. Try again, or use email.",
  unverified: "That Google account's email isn't verified. Use email sign-in instead.",
};

/**
 * Hosted mode: resolves once there's a session. Shows a full-screen sign-in step until then.
 * Self-hosted servers never answer with code "signin", so this steps aside there.
 */
export async function ensureSignedIn() {
  const q = new URLSearchParams(location.search);
  const err = q.get("signin");
  if (err) { history.replaceState(null, "", "/" + location.hash); }
  try { await get("/api/me"); return; } catch (e) { if (e.code !== "signin") return; }
  let state = { google: false, freePhotos: 30, priceLabel: "$20/year" };
  try { state = await get("/api/auth/state"); } catch {}
  await new Promise(() => showLogin(state, SIGNIN_ERRORS[err] || "")); // the page reloads after signing in
}

function showLogin(state, initialError) {
  const el = document.createElement("section");
  el.className = "gate signin";
  el.setAttribute("aria-labelledby", "loginTitle");
  el.innerHTML = `<div class="gate-in">
    <header>${MARK}<h1 id="loginTitle">Log a meal from one photo</h1>
    <p class="gate-sub">Share a picture of your plate. We name each item, check the numbers, and you confirm before anything is saved.</p></header>
    <div id="loginBody"></div>
  </div>`;
  document.body.append(el);
  document.body.classList.add("gated");
  enter(el);
  const bodyEl = $("#loginBody", el);

  const entering = (prefill = "") => {
    bodyEl.innerHTML = `${state.google ? `<a class="btn wide google-btn" href="/api/auth/google">${GOOGLE}<span>Continue with Google</span></a>
      <div class="or"><span>or use email</span></div>` : ""}
      <form id="loginForm" novalidate>
        <label class="f" for="lEmail">Email<input id="lEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(prefill)}" required></label>
        <p class="gate-err small" id="lErr" role="alert">${esc(initialError)}</p>
        <button class="btn primary wide" id="lGo" type="submit">Send sign-in link</button>
      </form>
      <p class="tiny muted gate-fine">New accounts get ${esc(state.freePhotos)} photo logs or $1 of AI, whichever comes first. Typed logging is always free. After that it's ${esc(state.priceLabel)}, or bring your own OpenRouter key and it's free.</p>`;
    initialError = "";
    $("#loginForm", el).onsubmit = async (e) => {
      e.preventDefault();
      const email = $("#lEmail", el).value.trim(), errEl = $("#lErr", el), go = $("#lGo", el);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = "Enter a valid email address."; return; }
      errEl.textContent = ""; go.disabled = true; go.textContent = "Sending…";
      try { await post("/api/auth/email", { email }); sent(email); }
      catch (x) { errEl.textContent = x.message; go.disabled = false; go.textContent = "Send sign-in link"; toast(x.message); }
    };
    $("#lEmail", el).focus({ preventScroll: true });
  };

  const sent = (email) => {
    bodyEl.innerHTML = `<div class="panel sent"><span class="disc"><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg></span>
      <div><b>Check your email</b><span>We sent a link to ${esc(email)}. It works once and expires in 15 minutes.</span></div></div>
      <div class="stack"><button class="btn wide" id="lResend">Resend link</button><button class="btn wide ghost" id="lBack">Use a different email</button></div>`;
    $("#lResend", el).onclick = async (e) => { e.target.disabled = true; try { await post("/api/auth/email", { email }); toast("Link sent again"); } catch (x) { toast(x.message); } setTimeout(() => { e.target.disabled = false; }, 8000); };
    $("#lBack", el).onclick = () => entering(email);
  };
  entering();
}
