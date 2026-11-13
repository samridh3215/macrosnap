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

  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  fakeLLM: process.env.FAKE_LLM === "1",

  strava: {
    clientId: process.env.STRAVA_CLIENT_ID || "",
    clientSecret: process.env.STRAVA_CLIENT_SECRET || "",
  },

  food: {
    fuzzyAuto: Number(process.env.FUZZY_AUTO || 0.9), // >= this: reuse automatically (spelling variants)
    fuzzySuggest: Number(process.env.FUZZY_SUGGEST || 0.6), // >= this: ask "same as X?"
    promoteCorrectionsAt: Number(process.env.PROMOTE_CORRECTIONS_AT || 2), // repeated renames become aliases
    cacheTtlSec: 60 * 60 * 24 * 30,
  },
};

export const isDevOpen = () => config.tokens.size === 0;
