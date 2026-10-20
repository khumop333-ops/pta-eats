import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import { fetchRestaurantById, fetchRestaurants } from "./restaurants";

type Query = Record<string, ReturnType<typeof vi.fn>>;

function makeQuery(result: unknown): Query {
  const query: Query = {};
  query.select = vi.fn(() => query);
  query.order = vi.fn(() => Promise.resolve(result));
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => Promise.resolve(result));
  query.single = vi.fn(() => Promise.resolve(result));
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
