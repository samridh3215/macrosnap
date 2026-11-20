/* Macro Snap landing: interactives run on the product's own rules (energy.ts, validate.ts, key.ts).
   Everything works without GSAP; GSAP only adds entrances and scroll motion, and never under reduced motion. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fmt = function (n) { return Math.round(n).toLocaleString("en-US"); };
  var reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  var motionOK = function () { return !reduceMQ.matches && window.gsap; };

  /* ---------- 1. hero meal sheet: grams re-add the sheet ---------- */
  var sheet = $(".hero-sheet");
  var rows = $$("tbody tr[data-item]", sheet);
  var totalRow = $("tr.total", sheet);
  var bigEl = $("#big"), bigShown = 504, bigTween = null;

  function rowVals(tr) {
    var inp = $("input.gram", tr), g;
    if (inp) {
      g = Number(inp.value);
      return {
        g: g,
        p: Math.round(inp.dataset.p * g / 100), c: Math.round(inp.dataset.c * g / 100),
        f: Math.round(inp.dataset.f * g / 100), fi: Math.round(inp.dataset.fi * g / 100)
      };
    }
    return { g: 5, p: 0, c: 0, f: 5, fi: 0 }; // ghee note: 5 g of fat
  }
  function paintSheet() {
    var tot = { g: 0, p: 0, c: 0, f: 0, fi: 0 };
    rows.forEach(function (tr) {
      if (tr.hidden) return;
      var v = rowVals(tr), k = 4 * v.p + 4 * v.c + 9 * v.f + 2 * v.fi;
      ["g", "p", "c", "f", "fi"].forEach(function (key) { $("." + key, tr).textContent = v[key]; tot[key] += v[key]; });
      $(".k", tr).textContent = k;
    });
    var K = 4 * tot.p + 4 * tot.c + 9 * tot.f + 2 * tot.fi;
    ["g", "p", "c", "f", "fi"].forEach(function (key) { $("." + key, totalRow).textContent = tot[key]; });
    $(".k", totalRow).textContent = K;
    $("#eq").textContent = "4 × " + tot.p + " + 4 × " + tot.c + " + 9 × " + tot.f + " + 2 × " + tot.fi + " = " + K;
    setBig(K);
  }
  function setBig(K) {
    if (!motionOK()) { bigEl.textContent = K; bigShown = K; return; }
    if (bigTween) bigTween.kill();
    var o = { v: bigShown };
    bigTween = gsap.to(o, { v: K, duration: 0.45, ease: "power3.out", onUpdate: function () { bigEl.textContent = Math.round(o.v); bigShown = o.v; }, onComplete: function () { bigEl.textContent = K; bigShown = K; } });
  }
  if (sheet) {
    $$("input.gram", sheet).forEach(function (i) { i.addEventListener("input", paintSheet); });
    var ghee = $("#ghee");
    ghee.addEventListener("click", function () {
      var on = ghee.getAttribute("aria-pressed") !== "true";
      ghee.setAttribute("aria-pressed", String(on));
      ghee.textContent = on ? "Remove the ghee note" : "Add “extra ghee” note";
      var tr = $("[data-item=ghee]", sheet); tr.hidden = !on;
      if (on && motionOK()) gsap.from(tr, { opacity: 0, duration: 0.3, ease: "power2.out" });
      paintSheet();
    });
  }

  /* ---------- 2. the checks (validate.ts): try to fool it ---------- */
  var vIds = ["p", "c", "f", "fi", "k"];
  var v = {}; vIds.forEach(function (k) { v[k] = $("#v-" + k); });
  function num(el) { var n = parseFloat(el.value); return isNaN(n) ? 0 : n; }
  function paintChecks() {
    var P = num(v.p), C = num(v.c), F = num(v.f), Fi = num(v.fi), K = num(v.k);
    var at = 4 * P + 4 * C + 9 * F + 2 * Fi;
    var energyOK = Math.abs(K - at) <= Math.max(20, 0.12 * K);
    var mass = P + C + F + Fi, massOK = mass <= 100;
    var r1 = function (n) { return Math.round(n * 10) / 10; };
    $("#o-energy").innerHTML = "<b>Energy.</b> Macros give " + r1(at) + " kcal, you said " + K + ". " + (energyOK ? "Passes." : "Fails.");
    $("#o-mass").innerHTML = "<b>Mass.</b> " + r1(mass) + " g per 100 g. " + (massOK ? "Passes." : "Fails.");
    var ok = energyOK && massOK, vd = $("#o-verdict");
    vd.textContent = ok ? "Stored and reused." : "Sent back with the errors.";
    vd.dataset.ok = ok ? "true" : "false";
    $("[data-rule=energy]").classList.toggle("is-fail", !energyOK);
    $("[data-rule=mass]").classList.toggle("is-fail", !massOK);
  }
  if (v.k) {
    vIds.forEach(function (k) { v[k].addEventListener("input", paintChecks); });
    $$("[data-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.dataset.preset.split(","); vIds.forEach(function (k, i) { v[k].value = a[i]; }); paintChecks();
      });
    });
    $("#v-break").addEventListener("click", function () { v.k.value = Math.round(num(v.k) * 1.7 + 30); paintChecks(); });
    paintChecks();
  }

  /* ---------- 3. targets (energy.ts): level, goal and weight ---------- */
  var PRESETS = [
    { neat: 1.2, ex: 0, fat: 0.33, dp: 0, blurb: "Least active: desk day, barely moving" },
    { neat: 1.3, ex: 150, fat: 0.30, dp: 0, blurb: "Light: walks, mobility, light yoga" },
    { neat: 1.35, ex: 300, fat: 0.28, dp: 0, blurb: "Moderate: zone 2, technique, light lifting" },
    { neat: 1.375, ex: 450, fat: 0.25, dp: 0, blurb: "Very active: a regular hard training session" },
    { neat: 1.4, ex: 800, fat: 0.20, dp: 0.2, blurb: "Super active: intervals, long run, heavy lifting" }
  ];
  var PROT = { cut: 2.7, maintain: 2.3, bulk: 2.4 };
  var GOALTXT = { cut: "Target on a cut", maintain: "Target at maintenance", bulk: "Target on a bulk" };
  var K = 340 / 4400, level = 3;
  var bars = $$("#bars .bar");
  function state() {
    return { w: Number($("#wt").value), goal: ($("input[name=goal]:checked") || {}).value || "cut" };
  }
  function calc(p, w, goal) {
    var lbm = w * 0.82, bmr = 370 + 21.6 * lbm;
    var tdee = bmr * p.neat + p.ex, daily = 0.005 * w * 1100, t = tdee;
    if (goal === "cut") t = tdee - Math.min(daily, 0.25 * tdee);
    if (goal === "bulk") t = tdee + Math.min(daily, 0.15 * tdee);
    var floor = Math.max(bmr, 1500); if (t < floor) t = floor;
    var pr = lbm * PROT[goal] + p.dp * w, f = Math.max(0.7 * w, p.fat * t / 9), c = (t - pr * 4 - f * 9) / 4;
    return { bmr: bmr, tdee: tdee, t: t, p: pr, f: f, c: c };
  }
  function paintTargets(fromZero) {
    var s = state();
    bars.forEach(function (b, i) {
      var r = calc(PRESETS[i], s.w, s.goal);
      var rect = $("rect", b), maint = $(".maint", b), val = $(".val", b);
      rect.style.transform = "scaleY(" + (fromZero ? 0 : (r.t / 4400).toFixed(4)) + ")";
      maint.style.transform = "translateY(" + (fromZero ? 0 : (-r.tdee * K).toFixed(1)) + "px)";
      val.style.transform = "translateY(" + (fromZero ? 0 : (-(r.t * K + 9)).toFixed(1)) + "px)";
      val.textContent = fmt(r.t);
      b.classList.toggle("is-on", i === level);
    });
    var r = calc(PRESETS[level], s.w, s.goal);
    $("#blurb").textContent = PRESETS[level].blurb;
    $("#r-bmr").textContent = fmt(r.bmr); $("#r-maint").textContent = fmt(r.tdee); $("#r-target").textContent = fmt(r.t);
    $("#r-p").textContent = fmt(r.p); $("#r-c").textContent = fmt(r.c); $("#r-f").textContent = fmt(r.f);
    $("#r-tl").textContent = GOALTXT[s.goal];
    $("#wout").textContent = s.w + " kg"; $("#cap-w").textContent = s.w;
  }
  if (bars.length) {
    $$("#levels input").forEach(function (el) { el.addEventListener("change", function () { level = Number(el.value) - 1; paintTargets(); }); });
    $$("input[name=goal]").forEach(function (el) { el.addEventListener("change", function () { paintTargets(); }); });
    $("#wt").addEventListener("input", function () { paintTargets(); });
    bars.forEach(function (b, i) {
      b.addEventListener("click", function () { level = i; $('#levels input[value="' + (i + 1) + '"]').checked = true; paintTargets(); });
    });
    paintTargets();
  }

  /* ---------- 4. library matcher (key.ts, simplified) ---------- */
  var LIB = ["chicken tikka", "paneer tikka masala", "dal", "roti", "chicken biryani", "basmati rice"];
  var SYN = { daal: "dal", dhal: "dal", chapati: "roti", chapatti: "roti", phulka: "roti", curd: "yogurt", dahi: "yogurt", yoghurt: "yogurt" };
  var FILL = { homemade: 1, with: 1, and: 1, of: 1, the: 1, a: 1 };
  function sing(w) { return w.length > 3 && /s$/.test(w) && !/(ss|us|as)$/.test(w) ? w.slice(0, -1) : w; }
  function key(s) {
    var seen = {}, out = [];
    s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).forEach(function (w) {
      if (!w || FILL[w]) return;
      var t = SYN[w] || SYN[sing(w)] || sing(w);
      if (!FILL[t] && !seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out.sort().join(" ");
  }
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) d[i] = [i];
    for (j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  // soft token Jaccard, as in the app: near-identical spellings (>= 0.8, same first letter) count as equal
  function similarity(ka, kb) {
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    var A = ka.split(" "), B = kb.split(" "), used = {}, sum = 0, pairs = 0;
    A.forEach(function (a) {
      var best = -1, bs = 0;
      B.forEach(function (b, j) {
        if (used[j]) return;
        var s = a === b ? 1 : (a[0] === b[0] && Math.min(a.length, b.length) >= 4 ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);
        if (s > bs) { bs = s; best = j; }
      });
      if (best >= 0 && bs >= 0.8) { used[best] = 1; sum += bs; pairs++; }
    });
    return sum / (A.length + B.length - pairs);
  }
  function match(q) {
    var k = key(q), best = null, score = 0;
    LIB.forEach(function (f) { var s = similarity(k, key(f)); if (s > score) { score = s; best = f; } });
    return { best: best, score: score };
  }
  function paintMatch() {
    var q = $("#m-in").value.trim(), out = $("#m-result");
    if (!q) { $("#m-closest").textContent = ""; $("#m-score").textContent = ""; out.textContent = ""; return; }
    var m = match(q);
    $("#m-closest").textContent = m.best; $("#m-score").textContent = m.score.toFixed(2);
    var msg, st;
    if (m.score >= 1) { msg = "Same food, found by name. No AI call."; st = "exact"; }
    else if (m.score >= 0.9) { msg = "Linked automatically. No AI call."; st = "auto"; }
    else if (m.score >= 0.6) { msg = "Asks: “Same as " + m.best + "?” A No is remembered."; st = "ask"; }
    else { msg = "New food. Worked out once, then reused."; st = "new"; }
    out.textContent = msg; out.dataset.state = st;
  }
  if ($("#m-in")) {
    $("#m-in").addEventListener("input", paintMatch);
    $$("[data-try]").forEach(function (b) { b.addEventListener("click", function () { $("#m-in").value = b.dataset.try; paintMatch(); }); });
    paintMatch();
  }

  /* ---------- 5. motion: entrances, scroll, tilt. Never under reduced motion ---------- */
  function boot() {
    if (!window.gsap) return;
    window.__landing = true;
    var mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", function () {
      gsap.registerPlugin(ScrollTrigger);

      // hero headline: words rise out of a mask
      var h1 = $(".hero-copy h1");
      h1.innerHTML = h1.textContent.split(" ").map(function (w) { return '<span class="w"><span class="wi">' + w + "</span></span>"; }).join(" ");
      var tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      document.documentElement.classList.remove("anim");
      tl.from(".nav-in > *", { y: -14, opacity: 0, duration: 0.5, stagger: 0.06 })
        .from(".wi", { yPercent: 110, duration: 0.8, stagger: 0.1 }, "-=0.3")
        .from(".hero-copy .lead, .hero-copy .actions", { y: 18, opacity: 0, duration: 0.6, stagger: 0.1 }, "-=0.45")
        .from(".hero-sheet", { y: 36, opacity: 0, duration: 0.8 }, "-=0.7")
        .from(".hero-sheet tbody tr:not([hidden]), .hero-sheet .sheet-head", { opacity: 0, y: 10, duration: 0.4, stagger: 0.08 }, "-=0.4")
        .from("#eq", { clipPath: "inset(0 100% 0 0)", duration: 0.7, ease: "power2.inOut" }, "-=0.1");
      var o = { v: 0 };
      tl.to(o, { v: 504, duration: 0.9, ease: "power2.out", onUpdate: function () { bigEl.textContent = Math.round(o.v); }, onComplete: function () { bigEl.textContent = "504"; } }, "-=1.2");

      // scroll progress under the nav
      gsap.to(".progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.2 } });

      // section reveals
      ScrollTrigger.batch(".section h2, .section .lead, .rules tbody tr, .file tbody tr, .facts li, .shot figcaption, .validator, .match, .code", {
        start: "top 88%", once: true,
        onEnter: function (els) { gsap.from(els, { y: 26, opacity: 0, duration: 0.7, ease: "power3.out", stagger: 0.08, overwrite: true }); }
      });

      // chart: bars grow when it scrolls in
      var chart = $("#chart");
      if (chart) {
        $(".chart").classList.add("is-live");
        paintTargets(true);
        ScrollTrigger.create({ trigger: chart, start: "top 80%", once: true, onEnter: function () { paintTargets(); } });
      }

      // screens: scrub each capture down its full length, and tilt toward the pointer
      $$(".shot").forEach(function (shot) {
        var frame = $(".shot-frame", shot), img = $("img", frame);
        gsap.to(img, {
          y: function () { return -(img.offsetHeight - frame.offsetHeight); }, ease: "none",
          scrollTrigger: { trigger: frame, start: "top 85%", end: "bottom 25%", scrub: 0.6, invalidateOnRefresh: true }
        });
        var rx = gsap.quickTo(frame, "rotationX", { duration: 0.5, ease: "power3" });
        var ry = gsap.quickTo(frame, "rotationY", { duration: 0.5, ease: "power3" });
        gsap.set(frame, { transformPerspective: 900 });
        shot.addEventListener("pointermove", function (e) {
          var b = frame.getBoundingClientRect();
          ry(((e.clientX - b.left) / b.width - 0.5) * 8); rx(-((e.clientY - b.top) / b.height - 0.5) * 6);
        });
        shot.addEventListener("pointerleave", function () { rx(0); ry(0); });
      });

      // the ink band's header marks draw in
      gsap.from(".file .hl", { clipPath: "inset(0 100% 0 0)", duration: 0.6, stagger: 0.12, ease: "power2.inOut", scrollTrigger: { trigger: ".file", start: "top 85%", once: true } });

      return function () { $(".chart") && $(".chart").classList.remove("is-live"); };
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
