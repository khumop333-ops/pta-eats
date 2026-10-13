import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backendMock = vi.hoisted(() => ({
  fetchRestaurants: vi.fn(),
  fetchRestaurantById: vi.fn(),
}));
const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/backend", () => ({
  backendEnabled: true,
  fetchRestaurantsFromBackend: backendMock.fetchRestaurants,
  fetchRestaurantByIdFromBackend: backendMock.fetchRestaurantById,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import { fetchRestaurantById, fetchRestaurants } from "./restaurants";

function makeQuery(result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.order = vi.fn(() => Promise.resolve(result));
  query.eq = vi.fn(() => query);
  query.single = vi.fn(() => Promise.resolve(result));
  return query;
}

describe("restaurant data fallbacks", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.clearAllMocks();
    backendMock.fetchRestaurants.mockResolvedValue([]);
    backendMock.fetchRestaurantById.mockRejectedValue(new Error("Backend unavailable"));
    supabaseMock.from.mockReturnValue(makeQuery({ data: [], error: null }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns demo restaurants and menus when both data sources are empty", async () => {
    const restaurants = await fetchRestaurants();

    expect(restaurants).toHaveLength(4);
    expect(restaurants[0]).toMatchObject({
      name: "Mama's Kitchen",
      image: "/restaurant-1.jpg",
    });
    expect(restaurants[0].menu.length).toBeGreaterThan(0);
    expect(restaurants[3].image).toBe("/hero-food.jpg");
  });

  it("maps old Vite source asset URLs to public image paths", async () => {
    backendMock.fetchRestaurants.mockResolvedValue([
      {
        id: 2,
        name: "Pretoria Grill House",
        cuisine: "Grill & BBQ",
        rating: 4.6,
        image_url: "/src/assets/restaurant-2.jpg",
        delivery_time: "20-30 min",
      },
    ]);

    const [restaurant] = await fetchRestaurants();

    expect(restaurant.image).toBe("/restaurant-2.jpg");
  });

  it("returns a matching demo restaurant when an individual lookup fails", async () => {
    supabaseMock.from.mockReturnValue(
      makeQuery({ data: null, error: { message: "Not found" } }),
    );

    const restaurant = await fetchRestaurantById(3);

    expect(restaurant).toMatchObject({
      id: 3,
      name: "Cape Town Fish & Chips",
      image: "/restaurant-3.jpg",
    });
    expect(restaurant?.menu.length).toBeGreaterThan(0);
  });
});
