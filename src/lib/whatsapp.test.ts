import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWhatsAppLink } from "./whatsapp";

const decode = (link: string) => decodeURIComponent(link.split("?text=")[1] ?? "");

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("falls back to the Roma number and returns an empty link when nothing is configured", () => {
    vi.stubEnv("VITE_ROMA_WHATSAPP_NUMBER", "");
    vi.resetModules();

    return import("./whatsapp").then(({ buildWhatsAppLink: build }) => {
      expect(build({ restaurantName: "Sheamus", restaurantSlug: "sheamus" })).toBe("");
    });
  });
});
