import type { Alias, Correction, Day, Food, Meal, User, Weight } from "../types.js";

/**
 * A food library: foods, aliases and learned corrections. Self-hosted uses one shared library (lib "");
 * hosted mode gives every user their own (lib = uid), so nothing is shared between accounts.
 */
export interface FoodStore {
  getFood(key: string): Promise<Food | null>;
  putFood(food: Food): Promise<void>;
  deleteFood(key: string): Promise<void>;
  listFoods(opts: { q?: string; limit?: number }): Promise<Food[]>;
  listFoodIndex(): Promise<Array<{ key: string; name: string }>>;

  getAlias(alias: string): Promise<Alias | null>;
  putAlias(a: Alias): Promise<void>;
  aliasesTo(target: string): Promise<Alias[]>;

  /** Increments and returns the new count. */
  bumpCorrection(from: string, to: string): Promise<number>;
}

/**
 * Durable system of record (SQLite self-hosted and hosted, Couchbase optional, in-memory/JSON file in dev).
 * The Store itself is the shared library (lib ""); `library(uid)` returns a per-user one.
 */
export interface Store extends FoodStore {
  readonly kind: string;
  init(): Promise<void>;
  close(): Promise<void>;

  /** The food library for `lib`. "" is the shared library (the Store itself). */
  library(lib: string): FoodStore;
  /** Deletes everything owned by a user, including their food library. */
  purgeUser(uid: string): Promise<void>;

  getUser(uid: string): Promise<User | null>;
  putUser(u: User): Promise<void>;

  getMeal(uid: string, id: string): Promise<Meal | null>;
  putMeal(m: Meal): Promise<void>;
  deleteMeal(uid: string, id: string): Promise<void>;
  listMeals(uid: string, from: string, to: string): Promise<Meal[]>;

  putWeight(w: Weight): Promise<void>;
  deleteWeight(uid: string, date: string): Promise<void>;
  listWeights(uid: string, from: string, to: string): Promise<Weight[]>;

  getDay(uid: string, date: string): Promise<Day | null>;
  putDay(d: Day): Promise<void>;
  listDays(uid: string, from: string, to: string): Promise<Day[]>;
}

export const ids = {
  meal: (uid: string, id: string) => `meal::${uid}::${id}`,
  weight: (uid: string, date: string) => `weight::${uid}::${date}`,
  day: (uid: string, date: string) => `day::${uid}::${date}`,
  // lib "" keeps the original ids so existing self-hosted data still resolves.
  food: (key: string, lib = "") => `food::${lib ? `${lib}::` : ""}${key.replace(/ /g, "_")}`,
  alias: (key: string, lib = "") => `alias::${lib ? `${lib}::` : ""}${key.replace(/ /g, "_")}`,
  correction: (from: string, to: string, lib = "") => `corr::${lib ? `${lib}::` : ""}${from.replace(/ /g, "_")}::${to.replace(/ /g, "_")}`,
  user: (uid: string) => `user::${uid}`,
};

export const now = () => new Date().toISOString();
