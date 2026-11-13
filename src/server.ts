import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./api/app.js";
import { config, isDevOpen } from "./config.js";
import { FoodRepo } from "./food/repo.js";
import { FakeLLM } from "./llm/fake.js";
import { OpenRouterLLM } from "./llm/openrouter.js";
import { NutritionService } from "./nutrition/pipeline.js";
import { MemoryCache, RedisCache, SafeCache } from "./storage/cache.js";
import { CouchbaseStore } from "./storage/couchbase.js";
import { MemoryStore } from "./storage/memory.js";
import type { Store } from "./storage/store.js";

async function main() {
  const store: Store = config.couchbase.connStr
    ? new CouchbaseStore(config.couchbase)
    : new MemoryStore(config.dataFile);
  await store.init();

  const cache = new SafeCache(config.redisUrl ? new RedisCache(config.redisUrl) : new MemoryCache());
  const llm = config.fakeLLM ? new FakeLLM() : new OpenRouterLLM(cache);
  const repo = new FoodRepo(store, cache);
  const nutrition = new NutritionService(repo, llm);
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
  const app = buildApp({ store, cache, repo, nutrition, llm, webRoot: process.env.WEB_ROOT || webRoot });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Macro Snap on :${info.port} · store=${store.kind} cache=${cache.kind} llm=${llm.kind}${isDevOpen() ? " · ⚠ no APP_TOKEN — API is open (dev mode)" : ""}`);
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
