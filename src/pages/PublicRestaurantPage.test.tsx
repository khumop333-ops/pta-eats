import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";

const fromMock = vi.hoisted(() => vi.fn());
const openWhatsAppMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());
const openNowMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));
vi.mock("@vercel/analytics", () => ({ track: trackMock }));
vi.mock("@/lib/whatsapp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsapp")>()),
  openWhatsApp: openWhatsAppMock,
}));
vi.mock("@/lib/business", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/business")>()),
  isOpenNow: openNowMock,
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
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Kota Classic",
    description: "Quarter loaf",
    price: 45,
    category: "Kota",
    image_url: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Magwinya (6)",
    description: "Fresh fat cakes",
    price: 20,
    category: "Snacks",
    image_url: null,
  },
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/r/magwinya-zone"]}>
      <CartProvider>
        <Routes>
          <Route path="/r/:slug" element={<PublicRestaurantPage />} />
          <Route path="/checkout" element={<p>Dormant checkout page</p>} />
          <Route path="/order" element={<p>Direct locked checkout</p>} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );

describe("public restaurant page ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openNowMock.mockReturnValue(true);
    window.localStorage.clear();
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

    expect(trackMock).toHaveBeenCalledWith(
      "add_to_cart",
      expect.objectContaining({ restaurant_slug: "magwinya-zone" }),
    );
  });

  it("hands a non-empty cart to direct checkout instead of opening any editable WhatsApp message", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add Kota Classic to cart" }));

    expect(screen.queryByRole("button", { name: /WhatsApp/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(await screen.findByText("Direct locked checkout")).toBeInTheDocument();
    expect(openWhatsAppMock).not.toHaveBeenCalled();
  });

  it("disables ordering until menu items are added and never opens a free-form WhatsApp chat", async () => {
    renderPage();

    await screen.findByRole("button", { name: "Add Kota Classic to cart" });
    const emptyButton = screen.getByRole("button", { name: "Add items to order" });
    expect(emptyButton).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Order on WhatsApp/i })).not.toBeInTheDocument();
    expect(openWhatsAppMock).not.toHaveBeenCalled();
  });

  it("opens the cart drawer and hands over to checkout", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add Kota Classic to cart" }));
    fireEvent.click(screen.getByRole("button", { name: /View cart/ }));

    const drawer = await screen.findByRole("dialog", { name: /Your cart/ });
    expect(within(drawer).getByText("Delivery fee")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Checkout" }));
    expect(await screen.findByText("Direct locked checkout")).toBeInTheDocument();
  });

  it("lets customers add dishes and pre-order when closed", async () => {
    openNowMock.mockReturnValue(false);
    renderPage();
    const add = await screen.findByRole("button", { name: "Add Kota Classic to cart" });
    expect(add).toBeEnabled();
    expect(screen.getByText(/confirm availability and delivery after reopening/i)).toBeInTheDocument();
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "Pre-order" }));
    expect(await screen.findByText("Direct locked checkout")).toBeInTheDocument();
  });

  it("allows pre-ordering from the cart drawer when closed", async () => {
    openNowMock.mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Kota Classic to cart" }));
    fireEvent.click(screen.getByRole("button", { name: /View cart/ }));
    const drawer = await screen.findByRole("dialog", { name: /Your cart/ });
    fireEvent.click(within(drawer).getByRole("button", { name: "Pre-order" }));
    expect(await screen.findByText("Direct locked checkout")).toBeInTheDocument();
  });

  it("shows a disabled pre-order prompt when closed with an empty cart", async () => {
    openNowMock.mockReturnValue(false);
    renderPage();
    await screen.findByRole("button", { name: "Add Kota Classic to cart" });
    const emptyPreorderBtn = screen.getByRole("button", { name: "Add items to pre-order" });
    expect(emptyPreorderBtn).toBeDisabled();
    expect(openWhatsAppMock).not.toHaveBeenCalled();
  });
});
