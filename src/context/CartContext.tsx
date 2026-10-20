import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  restaurantId: number;
  /** Shown in the cart so the customer always knows whose food this is. */
  restaurantName?: string;
}

/**
 * `restaurant-mismatch` means the cart already holds food from another kitchen.
 * The caller decides what to offer the customer — we never silently mix carts,
 * because create-order prices and validates a single restaurant per order.
 */
export type AddItemResult = "added" | "restaurant-mismatch";

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => AddItemResult;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  subtotal: number;
  itemCount: number;
  restaurantId: number | null;
  restaurantName: string | null;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

/**
 * Persist the cart so a refresh mid-checkout — or a tap away to WhatsApp to
 * ask a friend — never loses the order. Prices are always re-read from the
 * live menu by create-order, so a stale cart can never change what is charged;
 * the TTL exists so yesterday's basket doesn't reappear next week.
 */
export const CART_STORAGE_KEY = "roma-cart-v1";
export const CART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type StoredCart = { savedAt: number; items: CartItem[] };

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CartItem>;

  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.name === "string" &&
    isFiniteNonNegative(item.price) &&
    isFiniteNonNegative(item.restaurantId) &&
    Number.isInteger(item.quantity) &&
    (item.quantity as number) > 0 &&
    (item.restaurantName === undefined || typeof item.restaurantName === "string")
  );
}

function readStoredCart(): CartItem[] {
  if (typeof window === "undefined" || !window.localStorage) return [];

  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Partial<StoredCart>;
    if (!Array.isArray(parsed.items) || typeof parsed.savedAt !== "number") {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      return [];
    }

    if (Date.now() - parsed.savedAt > CART_MAX_AGE_MS) {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      return [];
    }

    const items = parsed.items.filter(isCartItem);
    // Never restore a mixed cart: create-order prices one restaurant per order.
    if (new Set(items.map((item) => item.restaurantId)).size > 1) {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      return [];
    }

    return items;
  } catch {
    return [];
  }
}

function writeStoredCart(items: CartItem[]) {
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    if (items.length === 0) {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      return;
    }
    const payload: StoredCart = { savedAt: Date.now(), items };
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private mode / quota: the cart still works for this page view.
  }
}

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>(readStoredCart);

  useEffect(() => {
    writeStoredCart(items);
  }, [items]);

  const addItem = useCallback(
    (item: Omit<CartItem, "quantity">): AddItemResult => {
      if (items.length > 0 && items[0].restaurantId !== item.restaurantId) {
        return "restaurant-mismatch";
      }

      setItems((prev) => {
        const existing = prev.find((i) => i.id === item.id);
        if (existing) {
          return prev.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
        }
        return [...prev, { ...item, quantity: 1 }];
      });

      return "added";
    },
    [items],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity } : i)));
    }
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        subtotal,
        itemCount,
        restaurantId: items[0]?.restaurantId ?? null,
        restaurantName: items[0]?.restaurantName ?? null,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
};
