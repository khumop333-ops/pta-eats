import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The storefront pages read auth/cart context only through the shared header,
// which is not used by these two guest routes, so a light provider stack is enough.
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import RestaurantDirectoryPage from "@/pages/RestaurantDirectoryPage";
import PublicRestaurantPage from "@/pages/PublicRestaurantPage";

/** Every PostgREST method returns the chain; awaiting it resolves the fixture. */
function queryChain(result: unknown) {
  const chain: Record<string, unknown> = {};

  for (const method of ["select", "eq", "order", "maybeSingle", "single"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve);

  return chain;
}

const renderAt = (path: string, ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/r" element={ui} />
          <Route path="/r/:slug" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("public storefront states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a branded empty state on the directory when nothing is listed", async () => {
    fromMock.mockReturnValue(queryChain({ data: [], error: null }));

    renderAt("/r", <RestaurantDirectoryPage />);

    expect(await screen.findByText("Roma is onboarding restaurants")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeInTheDocument();
  });

  it("surfaces a directory error with a working retry", async () => {
    fromMock
      .mockReturnValueOnce(queryChain({ data: null, error: { message: "boom" } }))
      .mockReturnValueOnce(queryChain({ data: [{ id: 1, name: "Magwinya Zone", slug: "magwinya" }], error: null }));

    renderAt("/r", <RestaurantDirectoryPage />);

    expect(await screen.findByText("Restaurants couldn’t be loaded right now")).toBeInTheDocument();

    screen.getByRole("button", { name: "Try again" }).click();

    expect(await screen.findByText("Magwinya Zone")).toBeInTheDocument();
  });

  it("shows the same fallback treatment for a restaurant with no photography", async () => {
    fromMock.mockImplementation((table: string) =>
      queryChain(
        table === "restaurants"
          ? {
              data: {
                id: 1,
                name: "Sheamus",
                slug: "sheamus",
                cuisine: "Local favourites",
                description: null,
                address_line: "Pretoria Central",
                suburb: null,
                city: "Pretoria",
                province: "Gauteng",
                cover_url: null,
                logo_url: null,
                image_url: "",
              },
              error: null,
            }
          : { data: [], error: null },
      ),
    );

    renderAt("/r/sheamus", <PublicRestaurantPage />);

    expect(await screen.findByText("Sheamus")).toBeInTheDocument();
    // No cover, no logo: the hero still renders with the Roma mark, and an
    // empty menu reads as "being updated" rather than a broken page.
    expect(
      screen.getByRole("img", { name: "Sheamus — no photo yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText("The menu is being updated")).toBeInTheDocument();
  });

  it("keeps the 404 page inside the storefront shell", async () => {
    fromMock.mockReturnValue(queryChain({ data: null, error: null }));

    renderAt("/r/gone", <PublicRestaurantPage />);

    expect(await screen.findByText("Restaurant not found")).toBeInTheDocument();
    // The notice CTA must not fight with the header/footer nav for the same label.
    expect(screen.getAllByRole("link", { name: "Browse restaurants" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "See all restaurants" })).toHaveAttribute("href", "/r");
  });
});
