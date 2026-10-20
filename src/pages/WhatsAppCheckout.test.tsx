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

vi.mock("@vercel/analytics", () => ({ track: trackMock }));
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
import { CLOSED_MESSAGE, DELIVERY_FEE } from "@/lib/business";

const CART_ITEMS = [
  {
    id: "menu-1",
    name: "Kota Classic",
    price: 45,
    quantity: 2,
    restaurantId: 7,
    restaurantName: "Magwinya Zone",
    restaurantSlug: "magwinya-zone",
  },
  {
    id: "menu-2",
    name: "Coke 330ml",
    price: 20,
    quantity: 1,
    restaurantId: 7,
    restaurantName: "Magwinya Zone",
    restaurantSlug: "magwinya-zone",
  },
];

const seedCart = () =>
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({ savedAt: Date.now(), items: CART_ITEMS }),
  );

const renderCheckout = () =>
  render(
    <MemoryRouter initialEntries={["/order"]}>
      <CartProvider>
        <Routes>
          <Route path="/order" element={<WhatsAppCheckout />} />
          <Route path="/r" element={<p>Restaurant directory</p>} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );

const decode = (link: string) => decodeURIComponent(link.split("?text=")[1] ?? "");

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

const submit = () => fireEvent.click(screen.getByRole("button", { name: /Send order on WhatsApp/ }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  openNowMock.mockReturnValue(true);
  openWhatsAppMock.mockReturnValue(true);
  // Real bank details, stubbed for the test.
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

describe("WhatsApp checkout", () => {
  it("offers bank transfer and cash on delivery without asking the customer to choose", () => {
    seedCart();
    renderCheckout();

    expect(screen.getByRole("heading", { name: "Pay by bank transfer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cash on delivery" })).toBeInTheDocument();
    // The owner asked for no payment-method question at checkout.
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

  it("uses the customer's name and phone as the payment reference", async () => {
    seedCart();
    renderCheckout();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Thabo Mokoena" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "072 123 4567" } });

    const referenceRow = screen.getByText("Payment reference").closest("div") as HTMLElement;
    expect(within(referenceRow).getByText("Thabo Mokoena 072 123 4567")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy payment reference" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Thabo Mokoena 072 123 4567"));
  });

  it("sends one itemised WhatsApp message with the delivery fee, then clears the cart", () => {
    seedCart();
    renderCheckout();

    const summary = screen.getByRole("heading", { name: "Your order" }).closest("section") as HTMLElement;
    expect(within(summary).getByText("R 130.00")).toBeInTheDocument();

    fillDeliveryDetails();
    submit();

    expect(openWhatsAppMock).toHaveBeenCalledTimes(1);
    const link = openWhatsAppMock.mock.calls[0][0];
    const message = decode(link);

    expect(link.startsWith("https://wa.me/")).toBe(true);
    expect(message).toContain("I'd like to order from Magwinya Zone");
    expect(message).toContain("2x Kota Classic — R45.00");
    expect(message).toContain("1x Coke 330ml — R20.00");
    expect(message).toContain("Subtotal: R110.00");
    expect(message).toContain(`Delivery fee: R${DELIVERY_FEE.toFixed(2)}`);
    expect(message).toContain("Total: R130.00");
    expect(message).toContain("Name: Thabo Mokoena");
    expect(message).toContain("Phone: 072 123 4567");
    expect(message).toContain("Delivery to: 123 Church Street, Arcadia");
    expect(message).toContain("Notes: Ring the buzzer at the gate");
    expect(message).toContain("Payment: bank transfer / cash on delivery");
    expect(message).toContain("Sent via roma.africa/r/magwinya-zone");

    expect(trackMock).toHaveBeenCalledWith("whatsapp_click", {
      restaurant_slug: "magwinya-zone",
      source: "checkout",
      item_count: 3,
      cart_value: 110,
    });

    // Confirmation replaces the form and the cart is emptied.
    expect(screen.getByRole("heading", { name: "Your order is ready" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Message Roma on WhatsApp again/ })).toHaveAttribute(
      "href",
      link,
    );
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it("keeps a tappable link when the browser blocks the WhatsApp window", () => {
    openWhatsAppMock.mockReturnValue(false);
    seedCart();
    renderCheckout();

    fillDeliveryDetails();
    submit();

    expect(screen.getByRole("alert")).toHaveTextContent(/blocked the WhatsApp window/i);
    expect(screen.getByRole("link", { name: /Message Roma on WhatsApp again/ })).toBeInTheDocument();
  });

  it("requires a name, phone number and address, even if the browser skips validation", () => {
    seedCart();
    renderCheckout();

    expect(screen.getByLabelText("Full name")).toBeRequired();
    expect(screen.getByLabelText("Phone number")).toBeRequired();
    expect(screen.getByLabelText("Delivery address")).toBeRequired();

    // In-app browsers submit anyway, so the page must guard in JavaScript too.
    const form = screen.getByLabelText("Full name").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(openWhatsAppMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Please add your name, phone number and delivery address so Roma can reach you.",
    );
    expect(screen.queryByRole("heading", { name: "Your order is ready" })).not.toBeInTheDocument();
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
    // Cash on delivery remains a complete, usable option.
    expect(screen.getByRole("heading", { name: "Cash on delivery" })).toBeInTheDocument();
  });

  it("blocks sending outside opening hours", () => {
    openNowMock.mockReturnValue(false);
    seedCart();
    renderCheckout();

    expect(screen.getByRole("alert")).toHaveTextContent(CLOSED_MESSAGE);
    expect(screen.getByRole("button", { name: "Closed" })).toBeDisabled();
  });

  it("shows an empty state instead of a checkout form with nothing in the cart", () => {
    renderCheckout();

    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });
});
