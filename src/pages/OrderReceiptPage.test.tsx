import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const writeText = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    user: null,
    profile: null,
    loading: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("@/context/CartContext", () => ({
  useCart: () => ({
    items: [],
    itemCount: 0,
    subtotal: 0,
    deliveryFee: 20,
    clearCart: vi.fn(),
  }),
}));

import OrderReceiptPage from "./OrderReceiptPage";
import { buildAdminCustomerWhatsAppLink, formatWhatsAppDigits } from "@/lib/directOrder";

const SAMPLE_RECEIPT = {
  order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  order_number: "ROMA-1042",
  receipt_token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  customer_name: "Lerato Nkosi",
  phone_number: "082 555 1234",
  delivery_address: "44 Pretorius Street, Pretoria Central",
  special_instructions: "Call on arrival",
  restaurant_id: 7,
  restaurant_name: "Magwinya Zone",
  restaurant_slug: "magwinya-zone",
  subtotal: "90.00",
  standard_delivery_fee: "15.00",
  delivery_fee: "0.00",
  total: "90.00",
  status: "Accepted",
  payment_method: "eft_or_cash",
  payment_status: "pending",
  promo_code: "FD-8822KK",
  is_preorder: false,
  created_at: "2026-11-24T11:15:00Z",
  items: [{ id: "line-1", name: "Kota Classic", price: "45.00", quantity: 2, line_total: "90.00" }],
};

describe("OrderReceiptPage & directOrder helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("loads and renders an authentic server-locked receipt by token", async () => {
    rpcMock.mockResolvedValue({ data: SAMPLE_RECEIPT, error: null });

    render(
      <MemoryRouter initialEntries={["/receipt/cccccccc-cccc-4ccc-8ccc-cccccccccccc"]}>
        <Routes>
          <Route path="/receipt/:receiptToken" element={<OrderReceiptPage />} />
          <Route path="/r" element={<p>Restaurants</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(rpcMock).toHaveBeenCalledWith("get_order_receipt", {
      p_receipt_token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    const card = await screen.findByTestId("locked-order-receipt");
    expect(within(card).getByText("ROMA-1042")).toBeInTheDocument();
    expect(within(card).getByText("Status: Accepted")).toBeInTheDocument();
    expect(within(card).getByText("Magwinya Zone")).toBeInTheDocument();
    expect(within(card).getByText("FD-8822KK")).toBeInTheDocument();
    expect(within(card).getByText("FREE")).toBeInTheDocument();
    expect(within(card).getByText("Lerato Nkosi")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Copy Receipt Link/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/receipt/cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      ),
    );
  });

  it("displays 'Receipt not found' when a receipt token does not exist on the server", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    render(
      <MemoryRouter initialEntries={["/receipt/00000000-0000-4000-8000-000000000000"]}>
        <Routes>
          <Route path="/receipt/:receiptToken" element={<OrderReceiptPage />} />
          <Route path="/r" element={<p>Restaurants</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Receipt not found" })).toBeInTheDocument();
  });

  it("normalises South African customer phone numbers for 1-tap Admin WhatsApp outreach", () => {
    expect(formatWhatsAppDigits("082 555 1234")).toBe("27825551234");
    expect(formatWhatsAppDigits("+27 82 555 1234")).toBe("27825551234");

    const link = buildAdminCustomerWhatsAppLink({
      phone: "082 555 1234",
      customerName: "Lerato Nkosi",
      orderNumber: "ROMA-1042",
      restaurantName: "Magwinya Zone",
      total: 90,
      receiptToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    expect(link.startsWith("https://wa.me/27825551234?text=")).toBe(true);
    const decoded = decodeURIComponent(link.split("?text=")[1] ?? "");
    expect(decoded).toContain("ROMA-1042");
    expect(decoded).toContain("/receipt/cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });
});
