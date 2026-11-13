import { z } from "zod";

/** Step 1 — vision model: what is on the plate and how much. No calories here on purpose. */
export const IdentifyOut = z.object({
  meal_name: z.string().describe("Short name for the whole meal, e.g. 'Dal chawal with salad'"),
  items: z.array(z.object({
    seen_name: z.string().describe("What it literally looks like / what you'd call it"),
    canonical_name: z.string().describe("Most common Indian-English dish name, singular, no quantities"),
    portion: z.string().describe("Human description, e.g. '1 katori', '2 pieces', 'half plate'"),
    grams: z.number().describe("Edible weight as served (cooked), in grams"),
    count: z.number().nullable().describe("Number of pieces for countable items, else null"),
    is_addon: z.boolean().describe("True for extras from the user's note, e.g. extra ghee"),
    confidence: z.enum(["low", "medium", "high"]),
  })),
  notes: z.string().describe("One line on assumptions, or why nothing was found"),
});
export type IdentifyOut = z.infer<typeof IdentifyOut>;

/** Step 2 — reasoning model: per-100 g nutrition derived from a recipe decomposition. */
export const NutritionOut = z.object({
  foods: z.array(z.object({
    id: z.string().describe("Echo the id you were given"),
    canonical_name: z.string(),
    category: z.string().describe("e.g. 'dal/legume', 'bread', 'rice dish', 'curry', 'snack', 'beverage', 'dairy', 'fat/oil'"),
    per100g: z.object({
      kcal: z.number(), protein: z.number(), carbs: z.number().describe("available carbs, excluding fiber"),
      fat: z.number(), fiber: z.number(),
    }),
    unit: z.object({ name: z.string(), grams: z.number() }).nullable().describe("Typical piece for countables (roti ≈ 40 g), else null"),
    ingredients: z.array(z.object({
      name: z.string(), grams: z.number().describe("grams of this ingredient per 100 g of finished dish"), kcal: z.number(),
    })),
    assumptions: z.string().describe("Recipe/cooking assumptions in one or two sentences"),
    references: z.array(z.string()).describe("Data sources used, e.g. 'IFCT 2017: Bengal gram dal'"),
    confidence: z.enum(["low", "medium", "high"]),
  })),
});
export type NutritionOut = z.infer<typeof NutritionOut>;
