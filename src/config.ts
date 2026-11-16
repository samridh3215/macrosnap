// Central configuration. Everything optional has a sensible dev fallback so `npm run dev:fake`
// works with zero setup (in-memory store + in-memory cache + fake LLM).

function parseTokens(): Map<string, string> {
  // TOKENS="tokenA=samridh,tokenB=friend"  (multi-user ready)  or  APP_TOKEN="x" (single user "me")
  const m = new Map<string, string>();
  for (const pair of (process.env.TOKENS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [t, uid] = pair.split("=");
    if (t && uid) m.set(t, uid);
  }
  if (process.env.APP_TOKEN) m.set(process.env.APP_TOKEN, process.env.APP_UID || "me");
  return m;
}

export const config = {
  /** MODE=hosted: multi-user sign-up, a food library per user, platform AI key metered per user. */
  hosted: process.env.MODE === "hosted",
  port: Number(process.env.PORT || 8080),
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  tokens: parseTokens(),
  secret: process.env.SESSION_SECRET || process.env.APP_TOKEN || "dev-only-secret",
  defaultTz: process.env.DEFAULT_TZ || "Asia/Kolkata",

  couchbase: {
    connStr: process.env.COUCHBASE_CONNSTR || "", // couchbases://cb.xxxxx.cloud.couchbase.com
    username: process.env.COUCHBASE_USERNAME || "",
    password: process.env.COUCHBASE_PASSWORD || "",
    bucket: process.env.COUCHBASE_BUCKET || "macrosnap",
    scope: process.env.COUCHBASE_SCOPE || "app",
  },
  redisUrl: process.env.REDIS_URL || "", // rediss://default:pass@host:port
  dataFile: process.env.DATA_FILE || "./data/dev-store.json",
  sqliteFile: process.env.SQLITE_FILE || "", // self-hosted store, e.g. ./data/macrosnap.db

  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  fakeLLM: process.env.FAKE_LLM === "1",

  strava: {
    clientId: process.env.STRAVA_CLIENT_ID || "",
    clientSecret: process.env.STRAVA_CLIENT_SECRET || "",
  },

  judge: {
    mode: (process.env.JUDGE || "off") as "jev" | "heuristic" | "off",
    model: process.env.JEV_MODEL || "typesafe/jev-1.13", // docs examples use 1.13; set JEV_MODEL=typesafe/jev-1.14 to pin newer
    auto: Number(process.env.JUDGE_AUTO || 0.85), // same-dish probability needed to auto-link
    none: Number(process.env.JUDGE_NONE || 0.85), // "none of these" probability needed to skip the prompt
    plausible: 0.8,
    timeoutMs: 3000,
  },

  auth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    resendKey: process.env.RESEND_API_KEY || "",
    emailFrom: process.env.EMAIL_FROM || "Macro Snap <login@example.com>",
    sessionDays: Number(process.env.SESSION_DAYS || 60),
    trustProxy: process.env.TRUST_PROXY === "1", // behind your own reverse proxy: take the client IP from X-Forwarded-For
  },

  billing: {
    // Lemon Squeezy: the variant's checkout link (Share → Checkout URL) and the webhook signing secret.
    checkoutUrl: process.env.LEMONSQUEEZY_CHECKOUT_URL || "",
    webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "",
    priceLabel: process.env.PRICE_LABEL || "$20/year",
  },

  limits: {
    freePhotos: Number(process.env.FREE_PHOTOS || 30), // AI logs (photo or describe) on the platform key before paying
    freeCapUsd: Number(process.env.FREE_AI_CAP_USD || 1), // platform AI spend allowed before paying, whichever runs out first
    paidCapUsd: Number(process.env.PAID_AI_CAP_USD || 10), // platform AI spend per paid user per rolling 365 days
    freeDailyUsd: Number(process.env.FREE_DAILY_BUDGET_USD || 5), // all free users together, per 24 h; free AI pauses above it
  },

  food: {
    fuzzyAuto: Number(process.env.FUZZY_AUTO || 0.9), // >= this: reuse automatically (spelling variants)
    fuzzySuggest: Number(process.env.FUZZY_SUGGEST || 0.6), // >= this: ask "same as X?"
    promoteCorrectionsAt: Number(process.env.PROMOTE_CORRECTIONS_AT || 2), // repeated renames become aliases
    cacheTtlSec: 60 * 60 * 24 * 30,
  },
};

export const isDevOpen = () => !config.hosted && config.tokens.size === 0;

/** Hosted mode fails closed: refuse to start with settings that would leave it open or unsafe. */
export function hostedProblems(): string[] {
  const p: string[] = [];
  if (!config.hosted) return p;
  if ((process.env.SESSION_SECRET || "").length < 32) p.push("SESSION_SECRET must be set to a random string of at least 32 characters");
  if (!config.sqliteFile) p.push("SQLITE_FILE must be set (hosted mode stores accounts and per-user libraries in SQLite)");
  if (config.couchbase.connStr) p.push("unset COUCHBASE_CONNSTR: hosted mode needs SQLite");
  if (!config.publicUrl) p.push("PUBLIC_URL must be set (used for login links and OAuth redirects)");
  else if (!/^https:\/\//.test(config.publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(config.publicUrl)) p.push("PUBLIC_URL must be https:// (session cookies are Secure)");
  if (config.judge.mode === "jev") p.push("JUDGE=jev isn't metered per user; leave JUDGE unset in hosted mode");
  if (config.tokens.size) p.push("unset APP_TOKEN / TOKENS: hosted mode signs people in with sessions");
  if (!config.fakeLLM && !config.openrouterKey) p.push("OPENROUTER_API_KEY must be set (the platform key for users who don't bring their own)");
  return p;
}
