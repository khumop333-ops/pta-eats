import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

import { paymentErrorMessage, startYocoCheckout } from "./payments";

describe("startYocoCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the Yoco redirect URL for the existing order", async () => {
    invokeMock.mockResolvedValue({
      data: { redirectUrl: "https://payments.yoco.com/checkout/abc" },
      error: null,
    });

    await expect(startYocoCheckout("order-1")).resolves.toEqual({
      redirectUrl: "https://payments.yoco.com/checkout/abc",
    });
    expect(invokeMock).toHaveBeenCalledWith("create-yoco-payment", {
      body: { orderId: "order-1", returnOrigin: window.location.origin },
    });
  });

  it("throws when the function reports an error", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("Not configured") });

    await expect(startYocoCheckout("order-1")).rejects.toThrow(/Not configured/);
  });

  it("throws when Yoco returns no redirect URL", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });

    await expect(startYocoCheckout("order-1")).rejects.toThrow(/payment page/);
  });
});

describe("paymentErrorMessage", () => {
  it("explains missing Yoco configuration without leaking internals", () => {
    expect(paymentErrorMessage(new Error("YOCO_SECRET_KEY missing"))).toMatch(/aren’t available/);
  });

  it("recognises an already-paid order", () => {
    expect(paymentErrorMessage(new Error("Order already paid"))).toMatch(/already paid/);
  });

  it("falls back to a retry message", () => {
    expect(paymentErrorMessage(new Error("boom"))).toMatch(/try again/);
  });
});
