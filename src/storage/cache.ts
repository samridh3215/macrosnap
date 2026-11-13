import { Redis } from "ioredis";

/**
 * Hot cache in front of Capella (Redis in prod, in-process map in dev).
 * Holds: food docs, alias lookups, the fuzzy-match name index, OpenRouter model list,
 * and short-lived computed dashboards (keyed by a per-user version for instant invalidation).
 */
export interface Cache {
  readonly kind: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  incr(key: string): Promise<number>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  exists(key: string): Promise<boolean>;
  close(): Promise<void>;
}

export async function getJSON<T>(c: Cache, key: string): Promise<T | null> {
  const v = await c.get(key);
  if (v == null) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}
export const setJSON = (c: Cache, key: string, v: unknown, ttl?: number) => c.set(key, JSON.stringify(v), ttl);

export class MemoryCache implements Cache {
  readonly kind = "memory";
  private kv = new Map<string, { v: string; exp: number }>();
  private h = new Map<string, Map<string, string>>();
  private live(key: string) {
    const e = this.kv.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) { this.kv.delete(key); return null; }
    return e;
  }
  async get(key: string) { return this.live(key)?.v ?? null; }
  async set(key: string, v: string, ttl?: number) { this.kv.set(key, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }); }
  async del(...keys: string[]) { for (const k of keys) { this.kv.delete(k); this.h.delete(k); } }
  async incr(key: string) { const n = Number((await this.get(key)) || 0) + 1; await this.set(key, String(n)); return n; }
  async hset(key: string, f: string, v: string) { if (!this.h.has(key)) this.h.set(key, new Map()); this.h.get(key)!.set(f, v); }
  async hdel(key: string, f: string) { this.h.get(key)?.delete(f); }
  async hgetall(key: string) { return Object.fromEntries(this.h.get(key) ?? []); }
  async exists(key: string) { return this.live(key) != null || (this.h.get(key)?.size ?? 0) > 0; }
  async close() {}
}

export class RedisCache implements Cache {
  readonly kind = "redis";
  private r: Redis;
  constructor(url: string) {
    this.r = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false });
    this.r.on("error", (e) => console.warn(`[redis] ${e.message}`));
  }
  async get(key: string) { return this.r.get(key); }
  async set(key: string, v: string, ttl?: number) { if (ttl) await this.r.set(key, v, "EX", ttl); else await this.r.set(key, v); }
  async del(...keys: string[]) { if (keys.length) await this.r.del(...keys); }
  async incr(key: string) { return this.r.incr(key); }
  async hset(key: string, f: string, v: string) { await this.r.hset(key, f, v); }
  async hdel(key: string, f: string) { await this.r.hdel(key, f); }
  async hgetall(key: string) { return this.r.hgetall(key); }
  async exists(key: string) { return (await this.r.exists(key)) > 0; }
  async close() { await this.r.quit(); }
}

/**
 * Wraps a cache so a Redis outage degrades to "no cache" instead of failing requests —
 * Capella stays the source of truth.
 */
export class SafeCache implements Cache {
  constructor(private inner: Cache) {}
  get kind() { return this.inner.kind; }
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch (e) { console.warn(`[cache] ${(e as Error).message}`); return fallback; }
  }
  get(k: string) { return this.safe(() => this.inner.get(k), null); }
  set(k: string, v: string, t?: number) { return this.safe(() => this.inner.set(k, v, t), undefined); }
  del(...k: string[]) { return this.safe(() => this.inner.del(...k), undefined); }
  incr(k: string) { return this.safe(() => this.inner.incr(k), 0); }
  hset(k: string, f: string, v: string) { return this.safe(() => this.inner.hset(k, f, v), undefined); }
  hdel(k: string, f: string) { return this.safe(() => this.inner.hdel(k, f), undefined); }
  hgetall(k: string) { return this.safe(() => this.inner.hgetall(k), {} as Record<string, string>); }
  exists(k: string) { return this.safe(() => this.inner.exists(k), false); }
  close() { return this.safe(() => this.inner.close(), undefined); }
}
