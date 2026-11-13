import couchbase from "couchbase";
import type { Alias, Correction, Day, Food, Meal, User, Weight } from "../types.js";
import { ids, now, type Store } from "./store.js";

/**
 * Couchbase Capella store.
 * Layout: bucket <COUCHBASE_BUCKET> / scope <COUCHBASE_SCOPE> / collections below.
 * Collections and secondary indexes are created on startup if the DB user is allowed to;
 * otherwise create them once from the Capella UI (see README).
 */
const COLLECTIONS = ["foods", "aliases", "corrections", "users", "meals", "weights", "days"] as const;
type Col = (typeof COLLECTIONS)[number];

const INDEXES = [
  "CREATE INDEX ix_meals_uid_date IF NOT EXISTS ON meals(uid, date, ts)",
  "CREATE INDEX ix_weights_uid_date IF NOT EXISTS ON weights(uid, date)",
  "CREATE INDEX ix_days_uid_date IF NOT EXISTS ON days(uid, date)",
  "CREATE INDEX ix_foods_hits IF NOT EXISTS ON foods(hits DESC, name, `key`)",
  "CREATE INDEX ix_aliases_target IF NOT EXISTS ON aliases(target)",
];

export class CouchbaseStore implements Store {
  readonly kind = "couchbase";
  private cluster!: couchbase.Cluster;
  private scope!: couchbase.Scope;
  private cols = {} as Record<Col, couchbase.Collection>;

  constructor(private opts: { connStr: string; username: string; password: string; bucket: string; scope: string }) {}

  async init() {
    this.cluster = await couchbase.connect(this.opts.connStr, {
      username: this.opts.username,
      password: this.opts.password,
      configProfile: "wanDevelopment", // longer timeouts for a cloud cluster over the internet
    });
    const bucket = this.cluster.bucket(this.opts.bucket);
    await this.ensureSchema(bucket);
    this.scope = bucket.scope(this.opts.scope);
    for (const c of COLLECTIONS) this.cols[c] = this.scope.collection(c);
  }

  private async ensureSchema(bucket: couchbase.Bucket) {
    const mgr = bucket.collections();
    try { await mgr.createScope(this.opts.scope); } catch (e) {
      if (!(e instanceof couchbase.ScopeExistsError)) console.warn(`[capella] createScope skipped: ${(e as Error).message}`);
    }
    for (const c of COLLECTIONS) {
      try { await mgr.createCollection(c, this.opts.scope); } catch (e) {
        if (!(e instanceof couchbase.CollectionExistsError)) console.warn(`[capella] createCollection ${c} skipped: ${(e as Error).message}`);
      }
    }
    const s = bucket.scope(this.opts.scope);
    for (const stmt of INDEXES) {
      // Newly created collections can take a moment to become queryable; retry briefly.
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await s.query(stmt); break; } catch (e) {
          if (e instanceof couchbase.IndexExistsError) break;
          if (attempt === 4) console.warn(`[capella] index skipped (${stmt.split(" ")[2]}): ${(e as Error).message}`);
          else await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
  }

  async close() { await this.cluster?.close(); }

  private async get<T>(col: Col, id: string): Promise<T | null> {
    try { return (await this.cols[col].get(id)).content as T; } catch (e) {
      if (e instanceof couchbase.DocumentNotFoundError) return null;
      throw e;
    }
  }
  private async del(col: Col, id: string) {
    try { await this.cols[col].remove(id); } catch (e) { if (!(e instanceof couchbase.DocumentNotFoundError)) throw e; }
  }
  private async q<T>(stmt: string, parameters: Record<string, unknown>): Promise<T[]> {
    const res = await this.scope.query(stmt, { parameters, scanConsistency: couchbase.QueryScanConsistency.RequestPlus });
    return res.rows as T[];
  }

  getFood(key: string) { return this.get<Food>("foods", ids.food(key)); }
  async putFood(f: Food) { await this.cols.foods.upsert(ids.food(f.key), f); }
  deleteFood(key: string) { return this.del("foods", ids.food(key)); }
  listFoods({ q, limit = 200 }: { q?: string; limit?: number }) {
    if (!q) return this.q<Food>("SELECT f.* FROM foods f WHERE f.hits IS NOT MISSING ORDER BY f.hits DESC, f.name LIMIT $limit", { limit });
    return this.q<Food>(
      "SELECT f.* FROM foods f WHERE CONTAINS(LOWER(f.name), $q) OR CONTAINS(f.`key`, $q) OR ANY a IN f.aliases SATISFIES CONTAINS(LOWER(a), $q) END ORDER BY f.hits DESC LIMIT $limit",
      { q: q.toLowerCase(), limit },
    );
  }
  listFoodIndex() { return this.q<{ key: string; name: string }>("SELECT f.`key`, f.name FROM foods f", {}); }

  getAlias(alias: string) { return this.get<Alias>("aliases", ids.alias(alias)); }
  async putAlias(a: Alias) { await this.cols.aliases.upsert(ids.alias(a.alias), a); }
  aliasesTo(target: string) { return this.q<Alias>("SELECT a.* FROM aliases a WHERE a.target = $target", { target }); }

  async bumpCorrection(from: string, to: string) {
    const id = ids.correction(from, to);
    // Optimistic CAS loop — correct even if two devices rename at the same time.
    for (let i = 0; i < 5; i++) {
      try {
        const res = await this.cols.corrections.get(id);
        const c = res.content as Correction;
        c.count += 1; c.updatedAt = now();
        await this.cols.corrections.replace(id, c, { cas: res.cas });
        return c.count;
      } catch (e) {
        if (e instanceof couchbase.DocumentNotFoundError) {
          try { await this.cols.corrections.insert(id, { from, to, count: 1, updatedAt: now() }); return 1; }
          catch (e2) { if (!(e2 instanceof couchbase.DocumentExistsError)) throw e2; }
        } else if (!(e instanceof couchbase.CasMismatchError)) throw e;
      }
    }
    throw new Error("correction update contention");
  }

  getUser(uid: string) { return this.get<User>("users", ids.user(uid)); }
  async putUser(u: User) { await this.cols.users.upsert(ids.user(u.uid), u); }

  getMeal(uid: string, id: string) { return this.get<Meal>("meals", ids.meal(uid, id)); }
  async putMeal(m: Meal) { await this.cols.meals.upsert(ids.meal(m.uid, m.id), m); }
  deleteMeal(uid: string, id: string) { return this.del("meals", ids.meal(uid, id)); }
  listMeals(uid: string, from: string, to: string) {
    return this.q<Meal>("SELECT m.* FROM meals m WHERE m.uid = $uid AND m.date BETWEEN $from AND $to ORDER BY m.ts", { uid, from, to });
  }

  async putWeight(w: Weight) { await this.cols.weights.upsert(ids.weight(w.uid, w.date), w); }
  deleteWeight(uid: string, date: string) { return this.del("weights", ids.weight(uid, date)); }
  listWeights(uid: string, from: string, to: string) {
    return this.q<Weight>("SELECT w.* FROM weights w WHERE w.uid = $uid AND w.date BETWEEN $from AND $to ORDER BY w.date", { uid, from, to });
  }

  getDay(uid: string, date: string) { return this.get<Day>("days", ids.day(uid, date)); }
  async putDay(d: Day) { await this.cols.days.upsert(ids.day(d.uid, d.date), d); }
  listDays(uid: string, from: string, to: string) {
    return this.q<Day>("SELECT d.* FROM days d WHERE d.uid = $uid AND d.date BETWEEN $from AND $to ORDER BY d.date", { uid, from, to });
  }
}
