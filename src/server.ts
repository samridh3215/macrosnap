import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./api/app.js";
import { config, hostedProblems, isDevOpen } from "./config.js";
import { AccountStore } from "./hosted/accounts.js";
import { MeteredLLM } from "./hosted/meter.js";
import { ConsoleMailer, GoogleOAuth, LemonSqueezy, ResendMailer } from "./hosted/providers.js";
import type { HostedDeps } from "./hosted/routes.js";
import type { LLM } from "./llm/types.js";
import { FoodRepo } from "./food/repo.js";
import { FakeJudge, HeuristicJudge, type Judge } from "./judge/judge.js";
import { JevJudge } from "./llm/decisions.js";
import { FakeLLM } from "./llm/fake.js";
import { OpenRouterLLM } from "./llm/openrouter.js";
import { NutritionService } from "./nutrition/pipeline.js";
import { MemoryCache, RedisCache, SafeCache } from "./storage/cache.js";
import { MemoryStore } from "./storage/memory.js";
import { SqliteStore } from "./storage/sqlite.js";
import type { Store } from "./storage/store.js";

// The couchbase SDK is a native optional dependency; only load it when it's configured.
async function loadCouchbase(): Promise<Store> {
  try {
    const { CouchbaseStore } = await import("./storage/couchbase.js");
    return new CouchbaseStore(config.couchbase);
  } catch (e) {
    throw new Error(`COUCHBASE_CONNSTR is set but the couchbase package could not be loaded (${(e as Error).message}). Install it with "npm i couchbase", or unset COUCHBASE_CONNSTR to use SQLite.`);
  }
}

async function main() {
  const problems = hostedProblems();
  if (problems.length) throw new Error(`MODE=hosted refused to start:\n  - ${problems.join("\n  - ")}`);

  const store: Store = config.couchbase.connStr
    ? await loadCouchbase()
    : config.sqliteFile
      ? new SqliteStore(config.sqliteFile)
      : new MemoryStore(config.dataFile);
  await store.init();

  const cache = new SafeCache(config.redisUrl ? new RedisCache(config.redisUrl) : new MemoryCache());
  const baseLLM: LLM = config.fakeLLM ? new FakeLLM() : new OpenRouterLLM(cache);

  let hosted: HostedDeps | undefined;
  if (config.hosted) {
    const accounts = new AccountStore(config.sqliteFile).init();
    if (!config.auth.resendKey) console.warn("[hosted] RESEND_API_KEY not set: sign-in links are printed to this log instead of emailed");
    hosted = {
      accounts,
      mailer: config.auth.resendKey ? new ResendMailer(config.auth.resendKey, config.auth.emailFrom) : new ConsoleMailer(),
      google: config.auth.googleClientId && config.auth.googleClientSecret ? new GoogleOAuth(config.auth.googleClientId, config.auth.googleClientSecret) : null,
      billing: new LemonSqueezy(config.billing.checkoutUrl, config.billing.webhookSecret),
      limits: config.limits,
      platformKey: config.fakeLLM ? "fake-platform-key" : config.openrouterKey,
      secret: config.secret,
      publicUrl: config.publicUrl,
      sessionDays: config.auth.sessionDays,
      trustProxy: config.auth.trustProxy,
      priceLabel: config.billing.priceLabel,
    };
  }
  const llm: LLM = hosted ? new MeteredLLM(baseLLM, hosted.accounts) : baseLLM;
  const heuristic = new HeuristicJudge();
  const judge: Judge | null = config.judge.mode === "off" ? null
    : config.fakeLLM ? new FakeJudge()
    : config.judge.mode === "jev" ? new JevJudge(cache, heuristic) : heuristic;
  const repo = new FoodRepo(store, cache, judge);
  const nutrition = new NutritionService(repo, llm);
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
  const app = buildApp({ store, cache, repo, nutrition, llm, hosted, webRoot: process.env.WEB_ROOT || webRoot });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Macro Snap on :${info.port}${hosted ? " · HOSTED" : ""} · store=${store.kind} cache=${cache.kind} llm=${llm.kind} judge=${judge?.kind ?? "off"}${isDevOpen() ? " · ⚠ no APP_TOKEN — API is open (dev mode)" : ""}`);
  });

  const shutdown = async () => {
    server.close();
    hosted?.accounts.close();
    await Promise.allSettled([store.close(), cache.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
