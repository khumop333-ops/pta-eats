import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY, CartProvider } from "@/context/CartContext";
import { BANK_TRANSFER_DETAILS } from "@/config/bankTransfer";

const openWhatsAppMock = vi.hoisted(() => vi.fn((_link: string) => true));
const trackMock = vi.hoisted(() => vi.fn());
const openNowMock = vi.hoisted(() => vi.fn(() => true));
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const writeText = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const invokeMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() =>
  vi.fn(() => ({
    session: null,
    user: null,
    profile: null,
    loading: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  })),
);

vi.mock("@vercel/analytics", () => ({ track: trackMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
    rpc: rpcMock,
  },
}));
vi.mock("@/lib/whatsapp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsapp")>()),
  openWhatsApp: openWhatsAppMock,
}));
vi.mock("@/lib/business", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/business")>()),
  isOpenNow: openNowMock,
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

import WhatsAppCheckout from "./WhatsAppCheckout";
import { PREORDER_MESSAGE, DELIVERY_FEE, MAGWINYA_ZONE_DELIVERY_FEE } from "@/lib/business";

const MAGWINYA_CART_ITEMS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Kota Classic",
    price: 45,
    quantity: 2,
    restaurantId: 7,
    restaurantName: "Magwinya Zone",
    restaurantSlug: "magwinya-zone",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Coke 330ml",
    price: 20,
    quantity: 1,
    restaurantId: 7,
    restaurantName: "Magwinya Zone",
    restaurantSlug: "magwinya-zone",
  },
];

const SHEAMUS_CART_ITEMS = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Pap & Beef",
    price: 75,
    quantity: 1,
    restaurantId: 8,
    restaurantName: "Sheamus",
    restaurantSlug: "sheamus",
  },
];

function buildServerReceipt(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    order_number: "ROMA-1001",
    receipt_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    customer_name: "Thabo Mokoena",
    phone_number: "072 123 4567",
    delivery_address: "123 Church Street, Arcadia",
    special_instructions: "Ring the buzzer at the gate",
    restaurant_id: 7,
    restaurant_name: "Magwinya Zone",
    restaurant_slug: "magwinya-zone",
    subtotal: 110,
    standard_delivery_fee: 15,
    delivery_fee: 15,
    total: 125,
    status: "New",
    payment_method: "eft_or_cash",
    payment_status: "pending",
    promo_code: null,
    is_preorder: false,
    created_at: "2026-11-24T10:30:00Z",
    items: [
      { id: "item-1", name: "Kota Classic", price: 45, quantity: 2, line_total: 90 },
      { id: "item-2", name: "Coke 330ml", price: 20, quantity: 1, line_total: 20 },
    ],
    ...overrides,
  };
}

const seedCart = (items = MAGWINYA_CART_ITEMS) =>
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({ savedAt: Date.now(), items }),
  );

const renderCheckout = () =>
  render(
    <MemoryRouter initialEntries={["/order"]}>
      <CartProvider>
        <Routes>
          <Route path="/order" element={<WhatsAppCheckout />} />
          <Route path="/receipt/:receiptToken" element={<p>Receipt page</p>} />
          <Route path="/r" element={<p>Restaurant directory</p>} />
          <Route path="/auth" element={<p>Auth page</p>} />
          <Route path="/my-orders" element={<p>My Orders page</p>} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );

const fillDeliveryDetails = () => {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Thabo Mokoena" } });
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "072 123 4567" } });
  fireEvent.change(screen.getByLabelText("Delivery address"), {
    target: { value: "123 Church Street, Arcadia" },
  });
  fireEvent.change(screen.getByLabelText("Special instructions (optional)"), {
    target: { value: "Ring the buzzer at the gate" },
  });
};

const submit = () => fireEvent.click(screen.getByRole("button", { name: /^Place order$/i }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  openNowMock.mockReturnValue(true);
  openWhatsAppMock.mockReturnValue(true);
  invokeMock.mockResolvedValue({
    data: {
      receipt: buildServerReceipt(),
      notifications: { live_admin: "delivered", whatsapp_cloud: "sent", email: "sent" },
    },
    error: null,
  });
  rpcMock.mockResolvedValue({ data: buildServerReceipt(), error: null });
  useAuthMock.mockReturnValue({
    session: null,
    user: null,
    profile: null,
    loading: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  });
  Object.assign(BANK_TRANSFER_DETAILS, {
    bankName: "Example Bank",
    accountHolder: "Roma Trading (Pty) Ltd",
    accountNumber: "1234567890",
    branchCode: "123456",
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  window.localStorage.clear();
  Object.assign(BANK_TRANSFER_DETAILS, {
    bankName: "",
    accountHolder: "",
    accountNumber: "",
    branchCode: "",
  });
});

describe("Direct locked storefront checkout", () => {
  it("offers bank transfer and cash on delivery without asking the customer to choose", () => {
    seedCart();
    renderCheckout();

    expect(screen.getByRole("heading", { name: "Pay by bank transfer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cash on delivery" })).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/payment method/i)).not.toBeInTheDocument();
  });

  it("shows the account details in a definition list with labelled copy buttons", async () => {
    seedCart();
    renderCheckout();

    expect(screen.getByText("Roma Trading (Pty) Ltd")).toBeInTheDocument();
    expect(screen.getByText("Example Bank")).toBeInTheDocument();
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy account number" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1234567890"));
    expect(toastSuccess).toHaveBeenCalledWith("Account number copied");
  });

  it("uses the customer's name and phone as the pre-order payment reference", async () => {
    seedCart();
    renderCheckout();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Thabo Mokoena" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "072 123 4567" } });

    const referenceRow = screen.getByText("Payment reference").closest("div") as HTMLElement;
    expect(within(referenceRow).getByText("Thabo Mokoena 072 123 4567")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy payment reference" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Thabo Mokoena 072 123 4567"));
  });

  it("submits directly to the server with Magwinya Zone's R15 delivery fee, never opens an editable WhatsApp chat, and renders the Official Locked Receipt", async () => {
    seedCart(MAGWINYA_CART_ITEMS);
    renderCheckout();

    const summary = screen.getByRole("heading", { name: "Your order" }).closest("section") as HTMLElement;
    expect(within(summary).getByText(`R ${MAGWINYA_ZONE_DELIVERY_FEE.toFixed(2)}`)).toBeInTheDocument();
    expect(within(summary).getByText("R 125.00")).toBeInTheDocument();

    fillDeliveryDetails();
    submit();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("place-direct-order", {
      body: expect.objectContaining({
        customerName: "Thabo Mokoena",
        phone: "072 123 4567",
        address: "123 Church Street, Arcadia",
        instructions: "Ring the buzzer at the gate",
        items: [
          { menuItemId: "11111111-1111-4111-8111-111111111111", quantity: 2 },
          { menuItemId: "22222222-2222-4222-8222-222222222222", quantity: 1 },
        ],
      }),
    });

    // Zero customer-editable WhatsApp order draft was opened.
    expect(openWhatsAppMock).not.toHaveBeenCalled();

    expect(
      await screen.findByRole("heading", { name: "Order sent directly to Roma" }),
    ).toBeInTheDocument();

    const receiptCard = screen.getByTestId("locked-order-receipt");
    expect(within(receiptCard).getByText("ROMA-1001")).toBeInTheDocument();
    expect(within(receiptCard).getByText("Server-Verified · Locked Receipt")).toBeInTheDocument();
    expect(within(receiptCard).getByText("Magwinya Zone")).toBeInTheDocument();
    expect(within(receiptCard).getByText("R 125.00")).toBeInTheDocument();
    expect(within(receiptCard).getByRole("link", { name: /Open receipt page/i })).toHaveAttribute(
      "href",
      "/receipt/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    // Receipt image & link actions are available; no editable order message link exists.
    expect(screen.getByRole("button", { name: /Share Receipt Image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download PNG/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy Receipt Link/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Message Roma on WhatsApp/i })).not.toBeInTheDocument();

    // Cart is cleared and analytics recorded.
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(trackMock).toHaveBeenCalledWith(
      "order_placed",
      expect.objectContaining({
        restaurant_slug: "magwinya-zone",
        order_number: "ROMA-1001",
        item_count: 3,
        cart_value: 110,
        total_value: 125,
      }),
    );
  });

  it("charges the standard R20 delivery fee for other restaurants and falls back cleanly to place_storefront_order RPC if edge function is not yet deployed", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" },
    });
    rpcMock.mockResolvedValue({
      data: buildServerReceipt({
        order_number: "ROMA-1002",
        restaurant_id: 8,
        restaurant_name: "Sheamus",
        restaurant_slug: "sheamus",
        subtotal: 75,
        standard_delivery_fee: 20,
        delivery_fee: 20,
        total: 95,
        items: [{ id: "item-3", name: "Pap & Beef", price: 75, quantity: 1, line_total: 75 }],
      }),
      error: null,
    });

    seedCart(SHEAMUS_CART_ITEMS);
    renderCheckout();

    const summary = screen.getByRole("heading", { name: "Your order" }).closest("section") as HTMLElement;
    expect(within(summary).getByText(`R ${DELIVERY_FEE.toFixed(2)}`)).toBeInTheDocument();
    expect(within(summary).getByText("R 95.00")).toBeInTheDocument();

    fillDeliveryDetails();
    submit();

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("place_storefront_order", expect.any(Object)));
    expect(openWhatsAppMock).not.toHaveBeenCalled();

    const receiptCard = await screen.findByTestId("locked-order-receipt");
    expect(within(receiptCard).getByText("ROMA-1002")).toBeInTheDocument();
    expect(within(receiptCard).getByText("R 20.00")).toBeInTheDocument();
    expect(within(receiptCard).getByText("R 95.00")).toBeInTheDocument();
  });

  it("invites guests to sign up for free first delivery without blocking guest checkout", () => {
    seedCart(MAGWINYA_CART_ITEMS);
    renderCheckout();

    expect(screen.getByText(/Sign up & get this delivery for FREE/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up for free delivery" })).toHaveAttribute(
      "href",
      "/auth?mode=signup",
    );
  });

  it("auto-applies R0 delivery for signed-in users with credits and locks the FD-XXXXXX verification code onto the official receipt", async () => {
    const refreshProfile = vi.fn();
    useAuthMock.mockReturnValue({
      session: { user: { id: "user-1" } } as never,
      user: { id: "user-1", email: "thabo@example.com" } as never,
      profile: {
        full_name: "Thabo Mokoena",
        phone_number: "072 123 4567",
        referral_code: "ROMA-7K3P9X",
        free_delivery_credits: 1,
        orders_placed_count: 0,
      },
      loading: false,
      signOut: vi.fn(),
      refreshProfile,
    });

    invokeMock.mockResolvedValue({
      data: {
        receipt: buildServerReceipt({
          order_number: "ROMA-1005",
          delivery_fee: 0,
          standard_delivery_fee: 15,
          total: 110,
          promo_code: "FD-9X2M4K",
        }),
        notifications: { live_admin: "delivered" },
      },
      error: null,
    });

    seedCart(MAGWINYA_CART_ITEMS);
    renderCheckout();

    const summary = screen.getByRole("heading", { name: "Your order" }).closest("section") as HTMLElement;
    expect(within(summary).getByText("FREE")).toBeInTheDocument();
    expect(within(summary).getAllByText("R 110.00")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Delivery address"), {
      target: { value: "123 Church Street, Arcadia" },
    });
    submit();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(openWhatsAppMock).not.toHaveBeenCalled();
    expect(refreshProfile).toHaveBeenCalled();

    const receiptCard = await screen.findByTestId("locked-order-receipt");
    expect(within(receiptCard).getByText("FD-9X2M4K")).toBeInTheDocument();
    expect(within(receiptCard).getByText("FREE")).toBeInTheDocument();
    expect(screen.getByText(/Free delivery · Code FD-9X2M4K/i)).toBeInTheDocument();
  });

  it("requires a name, phone number and address, even if the browser skips validation", () => {
    seedCart();
    renderCheckout();

    expect(screen.getByLabelText("Full name")).toBeRequired();
    expect(screen.getByLabelText("Phone number")).toBeRequired();
    expect(screen.getByLabelText("Delivery address")).toBeRequired();

    const form = screen.getByLabelText("Full name").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(openWhatsAppMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Please add your name, phone number and delivery address so Roma can reach you.",
    );
  });

  it("shows 'bank details coming soon' instead of inventing an account number", () => {
    Object.assign(BANK_TRANSFER_DETAILS, {
      bankName: "",
      accountHolder: "",
      accountNumber: "",
      branchCode: "",
    });
    seedCart();
    renderCheckout();

    expect(screen.getByText("Bank details coming soon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy account number/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cash on delivery" })).toBeInTheDocument();
  });

  it("places a locked pre-order outside opening hours without opening WhatsApp", async () => {
    openNowMock.mockReturnValue(false);
    invokeMock.mockResolvedValue({
      data: {
        receipt: buildServerReceipt({
          order_number: "ROMA-1009",
          is_preorder: true,
        }),
        notifications: { live_admin: "delivered" },
      },
      error: null,
    });

    seedCart();
    renderCheckout();

    expect(screen.getByRole("alert")).toHaveTextContent(PREORDER_MESSAGE);
    fillDeliveryDetails();
    fireEvent.click(screen.getByRole("button", { name: "Place pre-order" }));

    expect(
      await screen.findByRole("heading", { name: "Pre-order sent directly to Roma" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Pre-order queued for next 08:00 SAST opening/i)).toBeInTheDocument();
    expect(openWhatsAppMock).not.toHaveBeenCalled();
  });

  it("shows an empty state instead of a checkout form with nothing in the cart", () => {
    renderCheckout();

    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });
});
