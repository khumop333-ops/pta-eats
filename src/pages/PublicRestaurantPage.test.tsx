import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";

const fromMock = vi.hoisted(() => vi.fn());
const openWhatsAppMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));
vi.mock("@vercel/analytics", () => ({ track: trackMock }));
vi.mock("@/lib/whatsapp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsapp")>()),
  openWhatsApp: openWhatsAppMock,
}));
vi.mock("@/lib/business", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/business")>()),
  isOpenNow: () => true,
}));

import PublicRestaurantPage from "./PublicRestaurantPage";

function queryChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "maybeSingle", "single"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve);
  return chain;
}

const restaurant = {
  id: 7,
  name: "Magwinya Zone",
  slug: "magwinya-zone",
  cuisine: "Street food",
  description: null,
  address_line: "Pretoria Central",
  suburb: null,
  city: "Pretoria",
  province: "Gauteng",
  cover_url: null,
  logo_url: null,
  image_url: "",
};

const menu = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Kota Classic", description: "Quarter loaf", price: 45, category: "Kota", image_url: null },
  { id: "22222222-2222-4222-8222-222222222222", name: "Magwinya (6)", description: "Fresh fat cakes", price: 20, category: "Snacks", image_url: null },
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/r/magwinya-zone"]}>
      <CartProvider>
        <Routes>
          <Route path="/r/:slug" element={<PublicRestaurantPage />} />
          <Route path="/checkout" element={<p>Checkout page</p>} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );

describe("public restaurant page ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockImplementation((table: string) =>
      queryChain(
        table === "restaurants"
          ? { data: restaurant, error: null }
          : { data: menu, error: null },
      ),
    );
  });

  it("adds dishes to the cart and shows the running subtotal", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add Kota Classic to cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Kota Classic to cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Magwinya (6) to cart" }));

    expect(screen.getByText("Your cart · R110.00")).toBeInTheDocument();
    expect(screen.getAllByText("2 in cart")).toHaveLength(1);

    // The WhatsApp button now carries the cart as an itemised message.
    fireEvent.click(screen.getByRole("button", { name: /Order on WhatsApp/ }));
    const link = openWhatsAppMock.mock.calls[0][0] as string;
    const message = decodeURIComponent(link.split("?text=")[1] ?? "");

    expect(message).toContain("2x Kota Classic — R45.00");
    expect(message).toContain("1x Magwinya (6) — R20.00");
    expect(message).toContain("Estimated: R110.00");
    expect(trackMock).toHaveBeenCalledWith(
      "add_to_cart",
      expect.objectContaining({ restaurant_slug: "magwinya-zone" }),
    );
  });

  it("keeps a plain WhatsApp enquiry when the cart is empty", async () => {
    renderPage();

    await screen.findByRole("button", { name: "Add Kota Classic to cart" });
    fireEvent.click(screen.getByRole("button", { name: /Order on WhatsApp/ }));

    const link = openWhatsAppMock.mock.calls[0][0] as string;
    expect(decodeURIComponent(link)).not.toContain("Estimated");
  });

  it("opens the cart drawer and hands over to checkout", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add Kota Classic to cart" }));
    fireEvent.click(screen.getByRole("button", { name: /View cart/ }));

    expect(await screen.findByRole("dialog", { name: /Your cart/ })).toBeInTheDocument();
    expect(screen.getByText("Delivery fee")).toBeInTheDocument();
  });
});
