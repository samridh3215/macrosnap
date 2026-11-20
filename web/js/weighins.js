import { del, get, put } from "./api.js";
import { $, closeSheet, esc, ICONS, n1, openSheet, toast, today, weekAverages } from "./util.js";

const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Every weigh-in, newest first, with the smoothed trend beside it. Add, edit or delete from here. */
export async function renderWeighIns(root) {
  root.innerHTML = `<header class="page-head back"><a class="round" href="#/trends" aria-label="Back to Trends">${ICONS.back}</a><h1>Weigh-ins</h1><button class="btn tonal" id="wiAdd">Add</button></header>
    <p class="small muted" style="margin:0 2px 14px">Weigh in at the same time each morning. The trend smooths out day-to-day water swings.</p>
    <div id="wiList"><div class="sk sk-row"></div><div class="sk sk-row"></div></div>`;
  let rows = [], to = today();
  const draw = () => {
    const wk = weekAverages(rows, to);
    $("#wiList", root).innerHTML = rows.length ? `<p class="small num" style="margin:0 2px 12px"><b>${wk.cur != null ? `${n1(wk.cur)} kg` : "—"}</b> average over the last 7 days${wk.prev != null ? ` · ${n1(wk.prev)} kg the week before` : ""}</p><ul class="meals">${rows.map((e) => `<li class="wi">
        <span class="grow"><span class="name">${dayLabel(e.date)}</span><span class="sub num">${e.trend != null ? `trend ${n1(e.trend)} kg` : "no trend yet"}</span></span>
        <span class="kc num">${n1(e.weight)} kg</span>
        <button class="ib" data-d="${e.date}" aria-label="Edit or delete ${dayLabel(e.date)}">${ICONS.more}</button></li>`).join("")}</ul>`
      : `<div class="empty-card"><span class="disc">${ICONS.book}</span><b>No weigh-ins yet</b><p>Add your first one and the trend line starts drawing.</p></div>`;
    $("#wiList", root).querySelectorAll("[data-d]").forEach((b) => b.onclick = () => editor(rows.find((r) => r.date === b.dataset.d)));
  };
  const load = async () => {
    try { const t = await get("/api/trends?days=90"); to = t.to; rows = t.series.filter((s) => s.weight != null).reverse(); draw(); }
    catch (e) { $("#wiList", root).innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  };
  const editor = (entry) => {
    let kg = entry?.weight ?? rows[0]?.weight ?? 70;
    const body = openSheet(`<div class="wi-sheet">
      <h2 class="sheet-title">${entry ? "Edit weigh-in" : "Add weigh-in"}</h2>
      <div class="wi-step"><button class="round" id="wDec" aria-label="Decrease by 0.1 kg">${ICONS.minus}</button><div><b class="num" id="wVal">${n1(kg)}</b><span>kg</span></div><button class="round" id="wInc" aria-label="Increase by 0.1 kg">${ICONS.plus}</button></div>
      <label class="f">Date<input id="wDate" type="date" max="${today()}" value="${entry?.date ?? today()}" ${entry ? "disabled" : ""}></label>
      <div class="foot">${entry ? `<button class="btn ghost danger" id="wDel">Delete</button>` : `<button class="btn ghost" id="wCancel">Cancel</button>`}<span class="grow"></span><button class="btn primary" id="wSave">Save weigh-in</button></div></div>`);
    const show = () => { $("#wVal", body).textContent = n1(kg); };
    $("#wDec", body).onclick = () => { kg = Math.max(25, Math.round((kg - 0.1) * 10) / 10); show(); };
    $("#wInc", body).onclick = () => { kg = Math.min(350, Math.round((kg + 0.1) * 10) / 10); show(); };
    $("#wCancel", body)?.addEventListener("click", () => closeSheet());
    $("#wSave", body).onclick = async () => {
      try { await put(`/api/weights/${$("#wDate", body).value || today()}`, { kg }); closeSheet(); toast("Weigh-in saved"); load(); } catch (e) { toast(e.message); }
    };
    $("#wDel", body)?.addEventListener("click", async () => {
      if (!confirm(`Delete the weigh-in for ${dayLabel(entry.date)}?`)) return;
      try { await del(`/api/weights/${entry.date}`); closeSheet(); toast("Deleted"); load(); } catch (e) { toast(e.message); }
    });
  };
  $("#wiAdd", root).onclick = () => editor(null);
  await load();
}
