import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./api/app.js";
import { config, isDevOpen } from "./config.js";
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
  const store: Store = config.couchbase.connStr
    ? await loadCouchbase()
    : config.sqliteFile
      ? new SqliteStore(config.sqliteFile)
      : new MemoryStore(config.dataFile);
  await store.init();

  const cache = new SafeCache(config.redisUrl ? new RedisCache(config.redisUrl) : new MemoryCache());
  const llm = config.fakeLLM ? new FakeLLM() : new OpenRouterLLM(cache);
  const heuristic = new HeuristicJudge();
  const judge: Judge | null = config.judge.mode === "off" ? null
    : config.fakeLLM ? new FakeJudge()
    : config.judge.mode === "jev" ? new JevJudge(cache, heuristic) : heuristic;
  const repo = new FoodRepo(store, cache, judge);
  const nutrition = new NutritionService(repo, llm);
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
  const app = buildApp({ store, cache, repo, nutrition, llm, webRoot: process.env.WEB_ROOT || webRoot });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Macro Snap on :${info.port} · store=${store.kind} cache=${cache.kind} llm=${llm.kind} judge=${judge?.kind ?? "off"}${isDevOpen() ? " · ⚠ no APP_TOKEN — API is open (dev mode)" : ""}`);
  });

  const shutdown = async () => {
    server.close();
    await Promise.allSettled([store.close(), cache.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
