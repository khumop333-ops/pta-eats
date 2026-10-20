import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { CART_MAX_AGE_MS, CART_STORAGE_KEY, CartProvider, useCart } from "./CartContext";

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;

// The cart persists to localStorage, so every test starts from a clean slate.
beforeEach(() => {
  window.localStorage.clear();
});

const magwinya = { id: "m1", name: "Kota", price: 45, restaurantId: 7, restaurantName: "Magwinya Zone" };
const sheamus = { id: "s1", name: "Pap & Wors", price: 70, restaurantId: 8, restaurantName: "Sheamus" };

describe("cart rules", () => {
  it("counts quantities and totals in rand", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      expect(result.current.addItem(magwinya)).toBe("added");
      expect(result.current.addItem(magwinya)).toBe("added");
    });

    expect(result.current.itemCount).toBe(2);
    expect(result.current.subtotal).toBe(90);
    expect(result.current.restaurantName).toBe("Magwinya Zone");
  });

  it("refuses to mix restaurants and leaves the original cart untouched", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(magwinya);
    });

    let outcome: ReturnType<typeof result.current.addItem> | undefined;
    act(() => {
      outcome = result.current.addItem(sheamus);
    });

    expect(outcome).toBe("restaurant-mismatch");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("m1");
  });

  it("allows a second restaurant once the cart is cleared", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(magwinya);
      result.current.clearCart();
    });
    act(() => {
      expect(result.current.addItem(sheamus)).toBe("added");
    });

    expect(result.current.restaurantId).toBe(8);
  });

  it("drops an item when its quantity reaches zero", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem(magwinya);
    });
    act(() => {
      result.current.updateQuantity("m1", 0);
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.itemCount).toBe(0);
  });
});

describe("cart provider without a provider", () => {
  it("throws a helpful error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCart())).toThrow(/CartProvider/);
    spy.mockRestore();
  });
});

describe("cart persistence", () => {
  const stored = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      savedAt: Date.now(),
      items: [{ ...magwinya, quantity: 2 }],
      ...overrides,
    });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores the cart after a remount (refresh mid-checkout)", () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => {
      first.result.current.addItem(magwinya);
      first.result.current.addItem(magwinya);
    });
    first.unmount();

    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.items).toHaveLength(1);
    expect(second.result.current.itemCount).toBe(2);
    expect(second.result.current.restaurantName).toBe("Magwinya Zone");
  });

  it("drops a cart older than 24 hours", () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      stored({ savedAt: Date.now() - CART_MAX_AGE_MS - 1000 }),
    );

    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(0);
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it("ignores corrupt entries and mixed-restaurant carts", () => {
    window.localStorage.setItem(CART_STORAGE_KEY, "{not json");
    expect(renderHook(() => useCart(), { wrapper }).result.current.items).toHaveLength(0);

    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        items: [{ ...magwinya, quantity: 1 }, { ...sheamus, quantity: 1 }],
      }),
    );
    expect(renderHook(() => useCart(), { wrapper }).result.current.items).toHaveLength(0);
  });

  it("clears storage when the cart is emptied", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem(magwinya);
    });
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();

    act(() => {
      result.current.clearCart();
    });
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });
});
