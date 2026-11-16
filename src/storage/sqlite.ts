import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Alias, Correction, Day, Food, Meal, User, Weight } from "../types.js";
import { ids, now, type FoodStore, type Store } from "./store.js";

/**
 * Self-hosted store: a single SQLite file (Node's built-in `node:sqlite`, no native deps).
 * Every collection is a table of JSON documents with a few extracted columns for range queries.
 */
const TABLES = ["foods", "aliases", "corrections", "users", "meals", "weights", "days"] as const;
type Table = (typeof TABLES)[number];

export class SqliteStore implements Store {
  readonly kind = "sqlite";
  private db!: DatabaseSync;
  constructor(private file: string) {}

  async init() {
    if (this.file !== ":memory:") mkdirSync(dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    for (const t of TABLES) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, uid TEXT, date TEXT, ts REAL, doc TEXT NOT NULL)`);
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS ix_meals ON meals(uid, date, ts)");
    this.db.exec("CREATE INDEX IF NOT EXISTS ix_weights ON weights(uid, date)");
    this.db.exec("CREATE INDEX IF NOT EXISTS ix_days ON days(uid, date)");
    for (const t of ["foods", "aliases", "corrections"]) this.db.exec(`CREATE INDEX IF NOT EXISTS ix_${t}_lib ON ${t}(uid)`);
  }
  async close() { this.db?.close(); }

  private put(t: Table, id: string, doc: object, uid: string | null = null, date: string | null = null, ts: number | null = null) {
    this.db.prepare(`INSERT OR REPLACE INTO ${t} (id, uid, date, ts, doc) VALUES (?, ?, ?, ?, ?)`).run(id, uid, date, ts, JSON.stringify(doc));
  }
  private get<T>(t: Table, id: string): T | null {
    const row = this.db.prepare(`SELECT doc FROM ${t} WHERE id = ?`).get(id) as { doc: string } | undefined;
    return row ? (JSON.parse(row.doc) as T) : null;
  }
  private del(t: Table, id: string) { this.db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id); }
  private range<T>(t: Table, uid: string, from: string, to: string, order: string): T[] {
    const rows = this.db.prepare(`SELECT doc FROM ${t} WHERE uid = ? AND date BETWEEN ? AND ? ORDER BY ${order}`).all(uid, from, to) as Array<{ doc: string }>;
    return rows.map((r) => JSON.parse(r.doc) as T);
  }

  // The shared library (lib ""): self-hosted mode.
  private shared?: SqliteLibrary;
  library(lib: string): FoodStore {
    if (!lib) return (this.shared ??= new SqliteLibrary(this.db, ""));
    return new SqliteLibrary(this.db, lib);
  }
  getFood(key: string) { return this.library("").getFood(key); }
  putFood(f: Food) { return this.library("").putFood(f); }
  deleteFood(key: string) { return this.library("").deleteFood(key); }
  listFoods(o: { q?: string; limit?: number }) { return this.library("").listFoods(o); }
  listFoodIndex() { return this.library("").listFoodIndex(); }
  getAlias(alias: string) { return this.library("").getAlias(alias); }
  putAlias(a: Alias) { return this.library("").putAlias(a); }
  aliasesTo(target: string) { return this.library("").aliasesTo(target); }
  bumpCorrection(from: string, to: string) { return this.library("").bumpCorrection(from, to); }

  async purgeUser(uid: string) {
    if (!uid) return;
    for (const t of TABLES) this.db.prepare(`DELETE FROM ${t} WHERE uid = ?`).run(uid);
    this.del("users", ids.user(uid));
  }

  async getUser(uid: string) { return this.get<User>("users", ids.user(uid)); }
  async putUser(u: User) { this.put("users", ids.user(u.uid), u); }

  async getMeal(uid: string, id: string) { return this.get<Meal>("meals", ids.meal(uid, id)); }
  async putMeal(m: Meal) { this.put("meals", ids.meal(m.uid, m.id), m, m.uid, m.date, m.ts); }
  async deleteMeal(uid: string, id: string) { this.del("meals", ids.meal(uid, id)); }
  async listMeals(uid: string, from: string, to: string) { return this.range<Meal>("meals", uid, from, to, "ts"); }

  async putWeight(w: Weight) { this.put("weights", ids.weight(w.uid, w.date), w, w.uid, w.date); }
  async deleteWeight(uid: string, date: string) { this.del("weights", ids.weight(uid, date)); }
  async listWeights(uid: string, from: string, to: string) { return this.range<Weight>("weights", uid, from, to, "date"); }

  async getDay(uid: string, date: string) { return this.get<Day>("days", ids.day(uid, date)); }
  async putDay(d: Day) { this.put("days", ids.day(d.uid, d.date), d, d.uid, d.date); }
  async listDays(uid: string, from: string, to: string) { return this.range<Day>("days", uid, from, to, "date"); }
}

/**
 * One food library inside the SQLite file. Rows carry the library in the `uid` column:
 * NULL for the shared self-hosted library (so existing files keep working), the user's uid in hosted mode.
 */
class SqliteLibrary implements FoodStore {
  constructor(private db: DatabaseSync, private lib: string) {}
  private get owner() { return this.lib || null; }
  private where() { return this.lib ? "uid = ?" : "uid IS NULL"; }
  private args() { return this.lib ? [this.lib] : []; }
  private put(t: string, id: string, doc: object) {
    this.db.prepare(`INSERT OR REPLACE INTO ${t} (id, uid, date, ts, doc) VALUES (?, ?, NULL, NULL, ?)`).run(id, this.owner, JSON.stringify(doc));
  }
  private get<T>(t: string, id: string): T | null {
    const row = this.db.prepare(`SELECT doc FROM ${t} WHERE id = ?`).get(id) as { doc: string } | undefined;
    return row ? (JSON.parse(row.doc) as T) : null;
  }
  private all<T>(t: string): T[] {
    return (this.db.prepare(`SELECT doc FROM ${t} WHERE ${this.where()}`).all(...this.args()) as Array<{ doc: string }>).map((r) => JSON.parse(r.doc) as T);
  }

  async getFood(key: string) { return this.get<Food>("foods", ids.food(key, this.lib)); }
  async putFood(f: Food) { this.put("foods", ids.food(f.key, this.lib), f); }
  async deleteFood(key: string) { this.db.prepare("DELETE FROM foods WHERE id = ?").run(ids.food(key, this.lib)); }
  async listFoods({ q, limit = 200 }: { q?: string; limit?: number }) {
    const needle = (q || "").toLowerCase();
    return this.all<Food>("foods")
      .filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.key.includes(needle) || f.aliases.some((a) => a.toLowerCase().includes(needle)))
      .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
  async listFoodIndex() { return this.all<Food>("foods").map((f) => ({ key: f.key, name: f.name })); }

  async getAlias(alias: string) { return this.get<Alias>("aliases", ids.alias(alias, this.lib)); }
  async putAlias(a: Alias) { this.put("aliases", ids.alias(a.alias, this.lib), a); }
  async aliasesTo(target: string) { return this.all<Alias>("aliases").filter((a) => a.target === target); }

  async bumpCorrection(from: string, to: string) {
    const id = ids.correction(from, to, this.lib);
    const c = this.get<Correction>("corrections", id) ?? { from, to, count: 0, updatedAt: now() };
    c.count += 1; c.updatedAt = now();
    this.put("corrections", id, c);
    return c.count;
  }
}
