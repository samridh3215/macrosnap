import { del, get, local, post } from "./api.js";
import { $, closeSheet, enter, esc, ICONS, openSheet, toast } from "./util.js";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");
const meter = (label, text, frac) => `<div class="meter"><div class="meter-h"><span>${label}</span><span class="num">${text}</span></div><div class="track" role="progressbar" aria-label="${label}" aria-valuenow="${Math.round(frac * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, Math.max(0, frac * 100)).toFixed(1)}%"></i></div></div>`;

/** Hosted only: who you are, your allowance, billing, sign-out and deletion. */
export async function renderAccount(root) {
  root.innerHTML = `<header class="acct-head"><div class="sk sk-av"></div></header><div class="sk sk-hero"></div>`;
  let a;
  try { a = await get("/api/account"); } catch (e) {
    root.innerHTML = `<header class="page-head"><h1>Account</h1></header><div class="empty-card"><span class="disc">${ICONS.info}</span><b>No account on this server</b><p>Accounts only exist on a hosted Macro Snap. This one is yours alone, so there is nothing to sign in to.</p></div>`;
    return;
  }
  const ac = a.access, byok = !!local.orKey;
  const plan = byok ? "Own key" : ac.paid ? "Yearly" : "Free";
  const until = a.plan?.status === "cancelled" ? `Ends ${fmtDate(a.plan.endsAt)}.` : a.plan?.renewsAt ? `Renews on ${fmtDate(a.plan.renewsAt)}.` : "";
  const usage = byok
    ? `<div class="panel"><h2>Using your OpenRouter key</h2><p class="body-s muted">No limits from us. AI calls are billed to your OpenRouter account.</p></div>`
    : ac.paid
      ? `<div class="panel"><div><h2>Yearly plan</h2><p class="body-s muted">${esc(until)}</p></div>${meter("AI spend this year", `$${ac.spentUsd.toFixed(2)} of $${ac.capUsd.toFixed(2)}`, ac.spentUsd / (ac.capUsd || 1))}</div>`
      : `<div class="panel"><div><h2>Free allowance</h2><p class="body-s muted">AI logging stops at whichever limit you reach first. Typed and library logging stay free.</p></div>
          ${meter("Photos", `${Math.min(ac.photos, ac.freePhotos)} of ${ac.freePhotos}`, ac.photos / (ac.freePhotos || 1))}
          ${ac.capUsd != null ? meter("AI spend", `$${(ac.spentUsd ?? 0).toFixed(2)} of $${(ac.capUsd ?? 1).toFixed(2)}`, (ac.spentUsd ?? 0) / (ac.capUsd || 1)) : ""}</div>`;
  root.innerHTML = `<header class="acct-head"><span class="avatar" aria-hidden="true">${esc((a.email || "?")[0].toUpperCase())}</span>
      <div><h1>Account</h1><span class="head-sub">${esc(a.email)}</span></div><span class="plan-chip">${plan}</span></header>
    <section aria-label="Usage">${usage}</section>
    ${!ac.paid && !byok ? `<section class="stack" aria-label="Upgrade">
      ${a.billing ? `<a class="btn primary wide split" href="/api/billing/checkout"><span>Subscribe yearly</span><span class="num">${esc(a.priceLabel)}</span></a>` : ""}
      <a class="btn wide split" href="#/settings"><span>Use your own OpenRouter key</span><span class="muted">Free, no limits</span></a></section>` : ""}
    ${a.plan?.portalUrl ? `<section class="stack"><a class="btn wide" href="${esc(a.plan.portalUrl)}" target="_blank" rel="noopener">Manage billing</a></section>` : ""}
    <section class="stack" aria-label="Session"><button class="btn wide" id="acOut">Sign out</button><button class="btn wide ghost danger" id="acDel">Delete account</button></section>`;
  enter(root);
  $("#acOut", root).onclick = async () => { await post("/api/auth/logout").catch(() => {}); location.replace("/"); };
  $("#acDel", root).onclick = () => confirmDelete();
}

/** Two steps, and the destructive fill only on the last one. */
function confirmDelete() {
  const body = openSheet(`<div class="del-sheet" role="alertdialog" aria-label="Delete account"></div>`, "modal");
  const step = (n) => {
    $(".del-sheet", body).innerHTML = n === 1
      ? `<h2 class="sheet-title">Delete your account?</h2><p class="body-s muted">We delete your meals, library, weigh-ins and photos. Your free-allowance record stays so a new sign-up with this email starts where you left off.</p>
         <div class="stack"><button class="btn primary wide" id="dContinue">Continue</button><button class="btn wide" id="dKeep">Keep my account</button></div>`
      : `<h2 class="sheet-title">This can’t be undone</h2><p class="body-s muted">Every meal, food, weigh-in and photo will be removed now. Export first if you want a copy.</p>
         <div class="stack"><button class="btn danger-fill wide" id="dGo">Delete permanently</button><button class="btn wide" id="dCancel">Cancel</button></div>`;
    $("#dContinue", body)?.addEventListener("click", () => step(2));
    $("#dKeep", body)?.addEventListener("click", () => closeSheet("modal"));
    $("#dCancel", body)?.addEventListener("click", () => closeSheet("modal"));
    $("#dGo", body)?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await del("/api/account"); location.replace("/"); } catch (x) { toast(x.message, 4000); e.target.disabled = false; }
    });
  };
  step(1);
}
