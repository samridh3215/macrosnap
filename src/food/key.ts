/**
 * Food identity. "Tandoori chicken", "chicken tandoori", "Chicken-Tandoori (homemade)" and
 * "tandoori chickens" must all land on the same cache entry; "lemon" and "melon" must not.
 *
 * Pipeline: lowercase → strip accents → split on non-alphanumerics → drop filler words →
 * singularize → apply spelling/synonym map → de-duplicate → sort tokens → join with " ".
 * Sorting *tokens* (not characters) gives order-independence without anagram collisions.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "n", "with", "of", "in", "on", "style", "homemade", "home", "made", "fresh",
  "plain", "served", "side", "some", "little", "bit", "dish", "recipe", "indian", "traditional", "classic",
  "simple", "basic", "healthy", "tasty", "delicious",
]);

// Spelling variants & regional synonyms → one canonical token. Extend freely.
const SYNONYMS: Record<string, string> = {
  daal: "dal", dhal: "dal", dahl: "dal",
  chapati: "roti", chapatti: "roti", chappati: "roti", phulka: "roti", fulka: "roti",
  yogurt: "curd", yoghurt: "curd", dahi: "curd",
  alu: "aloo", gobhi: "gobi", chhole: "chole", cholay: "chole", chholey: "chole",
  parantha: "paratha", prantha: "paratha", parotta: "parotta",
  bhature: "bhatura", murgh: "chicken", murg: "chicken", panir: "paneer",
  tika: "tikka", biriyani: "biryani", briyani: "biryani", biriani: "biryani",
  sambhar: "sambar", idly: "idli", dosai: "dosa", wada: "vada", vadai: "vada",
  poori: "puri", omelet: "omelette", omlet: "omelette", omlette: "omelette",
  makhni: "makhani", makhana: "makhana", rajmah: "rajma", channa: "chana",
  kheema: "keema", qeema: "keema", tandori: "tandoori", masaala: "masala",
  bhaji: "bhaji", bhajji: "bhaji", sabji: "sabzi", subzi: "sabzi", sabzee: "sabzi",
  ghee: "ghee", desi: "desi", pao: "pav", paav: "pav",
};

const KEEP_S = new Set(["hummus", "couscous", "asparagus", "molasses", "chips", "oats", "lentils", "greens", "peas", "nachos", "fries"]);

export function singularize(t: string): string {
  if (t.length <= 3 || KEEP_S.has(t)) {
    // Normalise a few plural-only words to a stable singular form anyway.
    if (t === "chips") return "chip";
    if (t === "lentils") return "lentil";
    if (t === "peas") return "pea";
    if (t === "fries") return "fry";
    return t;
  }
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.endsWith("oes")) return t.slice(0, -2);
  if (/(ches|shes|xes|sses|zes)$/.test(t)) return t.slice(0, -2);
  // Note: "-is" plurals are common in Indian food words (rotis, chapatis, kulfis), so only -ss/-us are protected.
  if (t.endsWith("s") && !/(ss|us)$/.test(t)) return t.slice(0, -1);
  return t;
}

export function tokens(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ") // "(homemade)" style qualifiers
    .replace(/[^a-z0-9]+/g, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(" ")) {
    if (!raw || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    const t = SYNONYMS[raw] ?? SYNONYMS[singularize(raw)] ?? singularize(raw);
    if (!STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

/** The cache identity. Empty string means "no usable name". */
export function foodKey(name: string): string {
  return [...new Set(tokens(name))].sort().join(" ");
}

/* ---------------- Fuzzy matching ---------------- */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const tokenSim = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);

/**
 * Soft token Jaccard: tokens count as equal if they're near-identical spellings
 * (≥ 0.8 similarity and same first letter, e.g. "chiken"≈"chicken", "makhni"≈"makhani").
 * "paneer tikka" vs "paneer tikka masala" → 0.67 (ask), "chicken biryani" vs "mutton biryani" → 0.33 (no).
 */
export function similarity(keyA: string, keyB: string): number {
  if (!keyA || !keyB) return 0;
  if (keyA === keyB) return 1;
  const A = keyA.split(" "), B = keyB.split(" ");
  const used = new Set<number>();
  let simSum = 0, pairs = 0;
  for (const a of A) {
    let best = -1, bestS = 0;
    B.forEach((b, j) => {
      if (used.has(j)) return;
      const s = a === b ? 1 : a[0] === b[0] && Math.min(a.length, b.length) >= 4 ? tokenSim(a, b) : 0;
      if (s > bestS) { bestS = s; best = j; }
    });
    if (best >= 0 && bestS >= 0.8) { used.add(best); simSum += bestS; pairs += 1; }
  }
  return simSum / (A.length + B.length - pairs);
}

export function bestMatch(key: string, index: Array<{ key: string; name: string }>, exclude: Set<string> = new Set()) {
  let best: { key: string; name: string; score: number } | null = null;
  for (const e of index) {
    if (e.key === key || exclude.has(e.key)) continue;
    const s = similarity(key, e.key);
    if (!best || s > best.score) best = { ...e, score: s };
  }
  return best;
}
