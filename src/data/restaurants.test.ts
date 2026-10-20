import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import { fetchRestaurantById, fetchRestaurants } from "./restaurants";

type Query = Record<string, ReturnType<typeof vi.fn>>;

/**
 * Chainable + awaitable, like the real PostgREST builder: any filter/order
 * call can be the last one before `await`.
 */
function makeQuery(result: unknown): Query {
  const query: Query = {};
  for (const method of ["select", "order", "eq", "in"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(() => Promise.resolve(result));
  query.then = vi.fn((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject),
  );
  return query;
}

/** Route `from(table)` to per-table results. */
function mockTables(tables: Record<string, unknown>) {
  const queries: Record<string, Query> = {};
  supabaseMock.from.mockImplementation((table: string) => {
    queries[table] = makeQuery(tables[table] ?? { data: [], error: null });
    return queries[table];
  });
  return queries;
}

const listedRow = {
  id: 2,
  name: "Pretoria Grill House",
  cuisine: "Grill & BBQ",
  rating: 4.6,
  image_url: "/src/assets/restaurant-2.jpg",
  delivery_time: "20-30 min",
  is_listed: true,
};

describe("fetchRestaurants listing rule", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("only asks for listed restaurants, same rule as the /r directory", async () => {
    const queries = mockTables({ restaurants: { data: [listedRow], error: null } });

    await fetchRestaurants();

    expect(queries.restaurants.eq).toHaveBeenCalledWith("is_listed", true);
  });

  it("only fetches menu items for the listed restaurants", async () => {
    const queries = mockTables({
      restaurants: { data: [listedRow], error: null },
      menu_items: {
        data: [{ id: "m1", restaurant_id: 2, name: "Wors roll", description: "", price: "65", category: "Grill" }],
        error: null,
      },
    });

    const restaurants = await fetchRestaurants();

    expect(queries.menu_items.in).toHaveBeenCalledWith("restaurant_id", [2]);
    expect(restaurants[0].menu).toEqual([
      { id: "m1", name: "Wors roll", description: "", price: 65, category: "Grill" },
    ]);
  });

  it("maps old Vite source asset URLs to public image paths", async () => {
    mockTables({ restaurants: { data: [listedRow], error: null } });

    const restaurants = await fetchRestaurants();

    expect(restaurants).toHaveLength(1);
    expect(restaurants[0].image).toBe("/restaurant-2.jpg");
  });

  describe("in development", () => {
    beforeEach(() => vi.stubEnv("DEV", true));

    it("returns demo restaurants when nothing is listed", async () => {
      mockTables({ restaurants: { data: [], error: null } });

      const restaurants = await fetchRestaurants();

      expect(restaurants).toHaveLength(4);
      expect(restaurants[0]).toMatchObject({ name: "Mama's Kitchen", image: "/restaurant-1.jpg" });
      expect(restaurants[0].menu.length).toBeGreaterThan(0);
      expect(restaurants[3].image).toBe("/hero-food.jpg");
    });

    it("returns demo restaurants when the fetch fails", async () => {
      mockTables({ restaurants: { data: null, error: { message: "offline" } } });

      await expect(fetchRestaurants()).resolves.toHaveLength(4);
    });

    it("returns a matching demo restaurant when an individual lookup fails", async () => {
      mockTables({ restaurants: { data: null, error: { message: "Not found" } } });

      const restaurant = await fetchRestaurantById(3);

      expect(restaurant).toMatchObject({ id: 3, name: "Cape Town Fish & Chips", image: "/restaurant-3.jpg" });
      expect(restaurant?.menu.length).toBeGreaterThan(0);
    });
  });

  describe("in production", () => {
    beforeEach(() => vi.stubEnv("DEV", false));

    it("returns an honest empty list when nothing is listed — never demo data", async () => {
      mockTables({ restaurants: { data: [], error: null } });

      await expect(fetchRestaurants()).resolves.toEqual([]);
    });

    it("throws on a failed fetch so the page can show its error + retry state", async () => {
      mockTables({ restaurants: { data: null, error: { message: "offline" } } });

      await expect(fetchRestaurants()).rejects.toMatchObject({ message: "offline" });
    });

    it("returns null (not a demo restaurant) when an individual lookup fails", async () => {
      mockTables({ restaurants: { data: null, error: { message: "Not found" } } });

      await expect(fetchRestaurantById(3)).resolves.toBeNull();
    });
  });
});

describe("menu item order", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Seeded menus rely on sort_order for item AND category order; without an
  // explicit ORDER BY Postgres may return e.g. "Add-ons" before "Kotas".
  it("homepage fetch orders menu items by sort_order", async () => {
    const queries = mockTables({ restaurants: { data: [listedRow], error: null } });

    await fetchRestaurants();

    expect(queries.menu_items.order).toHaveBeenCalledWith("sort_order");
  });

  it("single-restaurant fetch orders menu items by sort_order", async () => {
    const queries = mockTables({ restaurants: { data: listedRow, error: null } });

    await fetchRestaurantById(2);

    expect(queries.menu_items.order).toHaveBeenCalledWith("sort_order");
  });

  it("keeps categories in the order of their first item", async () => {
    mockTables({
      restaurants: { data: listedRow, error: null },
      menu_items: {
        data: [
          { id: "a", restaurant_id: 2, name: "Thuba 1 Kota", description: "", price: 35, category: "Kotas", image_url: null, sort_order: 10 },
          { id: "b", restaurant_id: 2, name: "Thuba 1 Dagwood", description: "", price: 60, category: "Dagwoods", image_url: null, sort_order: 110 },
          { id: "c", restaurant_id: 2, name: "Extra Egg", description: "", price: 5, category: "Add-ons", image_url: null, sort_order: 510 },
        ],
        error: null,
      },
    });

    const restaurant = await fetchRestaurantById(2);

    expect(restaurant?.menu.map((item) => item.category)).toEqual(["Kotas", "Dagwoods", "Add-ons"]);
  });
});
