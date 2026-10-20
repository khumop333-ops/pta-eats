import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWhatsAppLink, openWhatsApp } from "./whatsapp";

const decode = (link: string) => decodeURIComponent(link.split("?text=")[1] ?? "");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildWhatsAppLink", () => {
  it("itemises the cart with prices and a total", () => {
    const link = buildWhatsAppLink({
      to: "27612821819",
      restaurantName: "Magwinya Zone",
      restaurantSlug: "magwinya-zone",
      items: [
        { name: "Kota Classic", quantity: 2, priceCents: 4500 },
        { name: "Coke 330ml", quantity: 1, priceCents: 2000 },
      ],
    });

    expect(link.startsWith("https://wa.me/27612821819?text=")).toBe(true);

    const message = decode(link);
    expect(message).toContain("I'd like to order from Magwinya Zone");
    expect(message).toContain("2x Kota Classic — R45.00");
    expect(message).toContain("1x Coke 330ml — R20.00");
    expect(message).toContain("Estimated: R110.00");
    expect(message).toContain("Sent via roma.africa/r/magwinya-zone");
  });

  it("sends a plain enquiry when the cart is empty", () => {
    const message = decode(
      buildWhatsAppLink({ to: "27612821819", restaurantName: "Sheamus", restaurantSlug: "sheamus" }),
    );

    expect(message).toContain("I'd like to order from Sheamus");
    expect(message).not.toContain("Estimated");
  });

  it("writes a full checkout order: items, delivery fee, totals, customer and payment", () => {
    const message = decode(
      buildWhatsAppLink({
        to: "27612821819",
        restaurantName: "Magwinya Zone",
        restaurantSlug: "magwinya-zone",
        items: [
          { name: "Kota Classic", quantity: 2, priceCents: 4500 },
          { name: "Coke 330ml", quantity: 1, priceCents: 2000 },
        ],
        deliveryFeeCents: 2000,
        customer: {
          name: "Thabo Mokoena",
          phone: "072 123 4567",
          address: "123 Church Street, Arcadia",
          notes: "Ring the buzzer at the gate",
        },
        paymentMethod: "either",
      }),
    );

    // Items, then an explicit fee/total block instead of "Estimated".
    expect(message).toContain("2x Kota Classic — R45.00");
    expect(message).toContain("1x Coke 330ml — R20.00");
    expect(message).not.toContain("Estimated");
    expect(message).toContain("Subtotal: R110.00");
    expect(message).toContain("Delivery fee: R20.00");
    expect(message).toContain("Total: R130.00");

    expect(message).toContain("Name: Thabo Mokoena");
    expect(message).toContain("Phone: 072 123 4567");
    expect(message).toContain("Delivery to: 123 Church Street, Arcadia");
    expect(message).toContain("Notes: Ring the buzzer at the gate");
    expect(message).toContain("Payment: bank transfer / cash on delivery");

    // Reading order matters for whoever packs the order.
    expect(message.indexOf("Total: R130.00")).toBeLessThan(message.indexOf("Name: Thabo"));
    expect(message.indexOf("Delivery to:")).toBeLessThan(message.indexOf("Payment:"));
    expect(message).toMatch(
      /Payment: bank transfer \/ cash on delivery\nSent via roma\.africa\/r\/magwinya-zone$/,
    );
  });

  it("labels a chosen payment method and drops an empty notes line", () => {
    const message = decode(
      buildWhatsAppLink({
        to: "27612821819",
        restaurantName: "Sheamus",
        restaurantSlug: "sheamus",
        items: [{ name: "Kota", quantity: 1, priceCents: 4500 }],
        deliveryFeeCents: 2000,
        customer: { name: "Naledi", phone: "082 000 1111", address: "Hatfield", notes: "   " },
        paymentMethod: "cash-on-delivery",
      }),
    );

    expect(message).toContain("Payment: cash on delivery");
    expect(message).not.toContain("Notes:");
    expect(message).toContain("Total: R65.00");
  });

  it("omits the 'Sent via' line when the restaurant slug is unknown", () => {
    const message = decode(
      buildWhatsAppLink({
        to: "27612821819",
        restaurantName: "Sheamus",
        items: [{ name: "Kota", quantity: 1, priceCents: 4500 }],
        deliveryFeeCents: 2000,
      }),
    );

    expect(message).not.toContain("Sent via");
  });

  it("falls back to the Roma number and returns an empty link when nothing is configured", () => {
    vi.stubEnv("VITE_ROMA_WHATSAPP_NUMBER", "");
    vi.resetModules();

    return import("./whatsapp").then(({ buildWhatsAppLink: build }) => {
      expect(build({ restaurantName: "Sheamus", restaurantSlug: "sheamus" })).toBe("");
    });
  });
});

describe("openWhatsApp", () => {
  it("reports success when a window opens", () => {
    vi.stubGlobal("open", vi.fn(() => ({})));

    expect(openWhatsApp("https://wa.me/27612821819?text=hi")).toBe(true);
  });

  it("reports a blocked popup so checkout can show a tappable fallback", () => {
    vi.stubGlobal("open", vi.fn(() => null));

    expect(openWhatsApp("https://wa.me/27612821819?text=hi")).toBe(false);
  });

  it("does nothing and reports failure for an empty link", () => {
    expect(openWhatsApp("")).toBe(false);
  });
});
