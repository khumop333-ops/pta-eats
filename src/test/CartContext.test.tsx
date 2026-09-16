import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { CartProvider, useCart } from "@/context/CartContext";

const CartProbe = () => {
  const { items, addItem, subtotal, itemCount } = useCart();
  return (
    <div>
      <button onClick={() => addItem({ id: "one", name: "Burger", price: 50, restaurantId: 1 })}>Add burger</button>
      <button onClick={() => addItem({ id: "two", name: "Pizza", price: 80, restaurantId: 2 })}>Add pizza</button>
      <span data-testid="items">{items.map((item) => `${item.name}:${item.quantity}`).join(",")}</span>
      <span data-testid="subtotal">{subtotal}</span>
      <span data-testid="count">{itemCount}</span>
    </div>
  );
};

describe("CartProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("adds items and calculates totals", () => {
    render(<CartProvider><CartProbe /></CartProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add burger" }));
    fireEvent.click(screen.getByRole("button", { name: "Add burger" }));

    expect(screen.getByTestId("items").textContent).toBe("Burger:2");
    expect(screen.getByTestId("subtotal").textContent).toBe("100");
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("prevents mixing restaurants in one cart", () => {
    render(<CartProvider><CartProbe /></CartProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add burger" }));
    fireEvent.click(screen.getByRole("button", { name: "Add pizza" }));

    expect(screen.getByTestId("items").textContent).toBe("Burger:1");
    expect(screen.getByTestId("items").textContent).not.toContain("Pizza");
  });
});
