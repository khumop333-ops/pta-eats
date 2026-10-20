import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchRestaurantsMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());

vi.mock("@/data/restaurants", () => ({ fetchRestaurants: fetchRestaurantsMock }));
vi.mock("@vercel/analytics", () => ({ track: trackMock }));

import HeroSection from "./HeroSection";

const catalog = [
  {
    id: 7,
    name: "Magwinya Zone",
    cuisine: "Street food",
    rating: 4.5,
    image: "/placeholder.svg",
    deliveryTime: "20-30 min",
    menu: [
      { id: "m1", name: "Kota Classic", description: "Quarter loaf, chips, atchar", price: 45, category: "Kota" },
    ],
  },
  {
    id: 8,
    name: "Sheamus",
    cuisine: "Grill",
    rating: 4.2,
    image: "/placeholder.svg",
    deliveryTime: "25-35 min",
    menu: [{ id: "m2", name: "Pap & Wors", description: "With chakalaka", price: 70, category: "Mains" }],
  },
];

function renderHero() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HeroSection />} />
          <Route path="/restaurant/:id" element={<p>Restaurant page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const searchBox = () => screen.getByRole("searchbox", { name: "Search for restaurants or dishes" });

describe("HeroSection search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchRestaurantsMock.mockResolvedValue(catalog);
  });

  it("shows matching restaurants and dishes as links", async () => {
    renderHero();
    fireEvent.change(searchBox(), { target: { value: "kota" } });

    const dishes = await screen.findByRole("region", { name: "Dishes" });
    const dish = within(dishes).getByRole("link", { name: /Kota Classic/ });
    expect(dish).toHaveAttribute("href", "/restaurant/7");
    expect(dish).toHaveTextContent("R 45.00");
    expect(dish).toHaveTextContent("at Magwinya Zone");

    fireEvent.change(searchBox(), { target: { value: "sheamus" } });
    const restaurants = await screen.findByRole("region", { name: "Restaurants" });
    expect(within(restaurants).getByRole("link", { name: /Sheamus/ })).toHaveAttribute("href", "/restaurant/8");
  });

  it("does nothing for a one-letter query", async () => {
    renderHero();
    fireEvent.change(searchBox(), { target: { value: "k" } });

    expect(screen.queryByRole("region", { name: "Dishes" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
  });

  it("explains when nothing matches and offers the directory", async () => {
    renderHero();
    fireEvent.change(searchBox(), { target: { value: "sushi" } });

    expect(await screen.findByText("No matches for “sushi”.", { selector: "p.font-medium" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "browse all restaurants" })).toHaveAttribute("href", "/r");
  });

  it("Enter opens the top result and records the analytics event", async () => {
    renderHero();
    fireEvent.change(searchBox(), { target: { value: "wors" } });
    await screen.findByRole("region", { name: "Dishes" });

    fireEvent.submit(searchBox());

    expect(await screen.findByText("Restaurant page")).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith(
      "hero_search_select",
      expect.objectContaining({ kind: "dish", via: "enter" }),
    );
  });

  it("Escape and the labelled clear button both reset the search", async () => {
    renderHero();
    fireEvent.change(searchBox(), { target: { value: "kota" } });
    await screen.findByRole("region", { name: "Dishes" });

    fireEvent.keyDown(searchBox(), { key: "Escape" });
    expect(searchBox()).toHaveValue("");

    fireEvent.change(searchBox(), { target: { value: "kota" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(searchBox()).toHaveValue("");
  });

  it("degrades to a directory link if restaurants can't load", async () => {
    fetchRestaurantsMock.mockRejectedValue(new Error("offline"));
    renderHero();
    fireEvent.change(searchBox(), { target: { value: "kota" } });

    // The hook retries once (~1 s backoff) before giving up.
    expect(
      await screen.findByRole("link", { name: "Browse all restaurants" }, { timeout: 4000 }),
    ).toHaveAttribute("href", "/r");
  });
});
