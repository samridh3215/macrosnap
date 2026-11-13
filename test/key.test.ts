import { describe, expect, it } from "vitest";
import { foodKey, similarity } from "../src/food/key.js";

describe("foodKey", () => {
  it("is word-order independent", () => {
    expect(foodKey("Tandoori Chicken")).toBe(foodKey("chicken tandoori"));
    expect(foodKey("Chicken-Tandoori (homemade)")).toBe("chicken tandoori");
  });
  it("does not collide anagrams (the sorted-characters trap)", () => {
    expect(foodKey("lemon")).not.toBe(foodKey("melon"));
  });
  it("normalises plurals, spellings and synonyms", () => {
    expect(foodKey("2 Chapatis")).toBe(foodKey("roti"));
    expect(foodKey("Daal Tadka")).toBe(foodKey("dal tadka"));
    expect(foodKey("tandoori chickens")).toBe("chicken tandoori");
    expect(foodKey("Plain Yogurt")).toBe(foodKey("dahi"));
    expect(foodKey("Aloo Gobhi")).toBe(foodKey("gobi alu"));
    expect(foodKey("potatoes")).toBe("potato");
    expect(foodKey("Masala Dosai")).toBe(foodKey("dosa masala"));
  });
  it("keeps genuinely different dishes apart", () => {
    expect(foodKey("chicken biryani")).not.toBe(foodKey("mutton biryani"));
    expect(foodKey("aloo paratha")).not.toBe(foodKey("gobi paratha"));
  });
  it("returns empty for no usable words", () => {
    expect(foodKey("  the (homemade) ")).toBe("");
  });
});

describe("similarity", () => {
  it("auto-level for spelling slips", () => {
    expect(similarity(foodKey("chiken tikka"), foodKey("chicken tikka"))).toBeGreaterThanOrEqual(0.9);
    expect(similarity(foodKey("dal makhni"), foodKey("dal makhani"))).toBe(1); // synonym map
  });
  it("suggest-level for related dishes", () => {
    const s = similarity(foodKey("paneer tikka"), foodKey("paneer tikka masala"));
    expect(s).toBeGreaterThanOrEqual(0.6);
    expect(s).toBeLessThan(0.9);
  });
  it("low for different dishes", () => {
    expect(similarity(foodKey("chicken biryani"), foodKey("mutton biryani"))).toBeLessThan(0.6);
    expect(similarity(foodKey("lemon rice"), foodKey("melon"))).toBeLessThan(0.3);
  });
});
