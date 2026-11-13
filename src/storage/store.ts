import type { Alias, Correction, Day, Food, Meal, User, Weight } from "../types.js";

/**
 * Durable system of record (Couchbase Capella in prod, in-memory/JSON file in dev).
 * The food library here is global and grows over time; everything else is per user.
 */
export interface Store {
  readonly kind: string;
  init(): Promise<void>;
  close(): Promise<void>;

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
  food: (key: string) => `food::${key.replace(/ /g, "_")}`,
  alias: (key: string) => `alias::${key.replace(/ /g, "_")}`,
  correction: (from: string, to: string) => `corr::${from.replace(/ /g, "_")}::${to.replace(/ /g, "_")}`,
  user: (uid: string) => `user::${uid}`,
};

export const now = () => new Date().toISOString();
