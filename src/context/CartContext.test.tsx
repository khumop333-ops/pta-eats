import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { CartProvider, useCart } from "./CartContext";

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;

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
