import { describe, expect, it } from "vitest";
import { normalizeSearchText, searchCatalog } from "./search";

const catalog = [
  {
    id: 1,
    name: "Magwinya Zone",
    cuisine: "Street food",
    menu: [
      { id: "a", name: "Magwinya & polony", description: "Fat cakes with polony", category: "Magwinya", price: 15 },
      { id: "b", name: "Kota Classic", description: "Quarter loaf, chips, russian, atchar", category: "Kota", price: 45 },
    ],
  },
  {
    id: 2,
    name: "Sheamus",
    cuisine: "Grill",
    menu: [
      { id: "c", name: "Pap & Wors", description: "Pap, boerewors and chakalaka", category: "Mains", price: 70 },
      { id: "d", name: "Boerewors roll", description: null, category: "Grill", price: 55 },
    ],
  },
  { id: 3, name: "Café Kota", cuisine: null, menu: [] },
];

describe("normalizeSearchText", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizeSearchText("  Café  KOTA! ")).toBe("cafe kota");
  });

  it("is safe with null/undefined", () => {
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("searchCatalog", () => {
  it("ignores queries shorter than two characters", () => {
    expect(searchCatalog(catalog, "k")).toEqual({ restaurants: [], dishes: [], total: 0 });
    expect(searchCatalog(catalog, "   ")).toEqual({ restaurants: [], dishes: [], total: 0 });
  });

  it("finds restaurants by name and cuisine", () => {
    expect(searchCatalog(catalog, "magwinya").restaurants.map((r) => r.id)).toEqual([1]);
    expect(searchCatalog(catalog, "grill").restaurants.map((r) => r.id)).toEqual([2]);
  });

  it("matches accents loosely in both directions", () => {
    expect(searchCatalog(catalog, "cafe").restaurants.map((r) => r.id)).toEqual([3]);
    expect(searchCatalog(catalog, "CAFÉ").restaurants.map((r) => r.id)).toEqual([3]);
  });

  it("finds dishes by name, category and description, with their restaurant", () => {
    const { dishes } = searchCatalog(catalog, "wors");
    expect(dishes.map((d) => d.item.id)).toEqual(["c", "d"]);
    expect(dishes[0].restaurant.name).toBe("Sheamus");

    expect(searchCatalog(catalog, "chakalaka").dishes.map((d) => d.item.id)).toEqual(["c"]);
  });

  it("requires every word to match", () => {
    expect(searchCatalog(catalog, "pap wors").dishes.map((d) => d.item.id)).toEqual(["c"]);
    expect(searchCatalog(catalog, "pap pizza").total).toBe(0);
  });

  it("ranks names that start with the query first", () => {
    const { restaurants } = searchCatalog(catalog, "kota");
    // "Café Kota" matches by name word; Magwinya Zone doesn't match as a restaurant.
    expect(restaurants.map((r) => r.id)).toEqual([3]);

    const { dishes } = searchCatalog(catalog, "boerewors");
    // "Boerewors roll" (name prefix) beats "Pap & Wors" (description match).
    expect(dishes.map((d) => d.item.id)).toEqual(["d", "c"]);
  });

  it("caps each group but reports the full total", () => {
    const many = [
      { id: 9, name: "Big menu", cuisine: "", menu: Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, name: `Kota ${i}`, price: 40 })) },
    ];
    const result = searchCatalog(many, "kota", { limit: 5 });
    expect(result.dishes).toHaveLength(5);
    expect(result.total).toBe(8);
  });
});
