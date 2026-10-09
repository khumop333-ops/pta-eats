import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  restaurantId: number;
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  subtotal: number;
  itemCount: number;
  /** False until the stored cart has been read. Prevents a "cart is empty" flash. */
  hydrated: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

/**
 * The persisted cart is validated on read, not trusted.
 *
 * Anything in web storage is attacker-controllable and version-fragile: a user
 * can edit it, and an older build can leave a shape this build no longer
 * understands. Validating means a stale or tampered cart degrades to an empty
 * cart instead of crashing the app during render — which, for a shop front,
 * would take the whole store down for that visitor.
 *
 * Hand-written rather than zod, and that is a measured decision: zod is in
 * package.json but was never imported anywhere, so the bundler had been dropping
 * it entirely. Adding a schema to this provider pulled the whole library into
 * the main chunk — 633 kB -> 698 kB (182.6 kB -> 198.3 kB gzip). Fifteen
 * kilobytes of gzip is a real cost on Pretoria 3G and this is the entire
 * validation requirement. (G7 in the audit still calls for code-splitting; the
 * right home for a schema library is a lazily-loaded form, not the entry chunk.)
 *
 * Note the prices here are DISPLAY ONLY. The server re-prices every basket
 * through quote_order() at checkout, so a doctored price in storage cannot change
 * what anyone is charged. That is what makes it safe to keep prices in a
 * client-readable place at all.
 */
const MAX_CART_ITEMS = 100;
/** Matches the server's own clamp in quote_order(): above this it is not an order. */
const MAX_QUANTITY = 50;

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.name === "string" &&
    typeof item.price === "number" &&
    Number.isFinite(item.price) &&
    item.price >= 0 &&
    typeof item.quantity === "number" &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= MAX_QUANTITY &&
    typeof item.restaurantId === "number" &&
    Number.isInteger(item.restaurantId)
  );
}

/** Returns the stored items, or null if the payload cannot be trusted at all. */
function parseStoredCart(raw: unknown): CartItem[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_CART_ITEMS) return null;
  // A single bad entry must not discard the rest: dropping one line is a far
  // better outcome for a shopper than emptying their basket.
  return raw.filter(isCartItem);
}

const STORAGE_KEY = "roma.cart.v1";

/**
 * Read the stored cart.
 *
 * Every failure path returns an empty cart rather than throwing: storage may be
 * unavailable (Safari private mode), full, or hold corrupt data, and none of
 * those should stop someone from browsing a menu.
 */
function readStoredCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = parseStoredCart(JSON.parse(raw));
    if (parsed === null) {
      console.warn("[cart] discarding an unreadable stored cart");
      window.localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function writeStoredCart(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    // An empty cart is stored as a removed key rather than "[]", so a cleared
    // cart cannot be resurrected by a stale tab reading an old array.
    if (items.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota exhausted or storage disabled. The cart still works in memory for
    // this session; it simply will not survive a reload.
    console.warn("[cart] could not persist the cart");
  }
}

export const CartProvider = ({ children }: { children: ReactNode }) => {
  // Starts EMPTY and is filled from storage in an effect below.
  //
  // Reading storage in the initialiser would be faster, but it makes the first
  // client render differ from the server render the moment this project is
  // server-rendered, and React resolves that with a hydration mismatch. Reading
  // after mount is identical under every renderer, which is the point: this
  // slice must not depend on the stack decision.
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Guards the write-back effect so it cannot overwrite stored contents with the
  // intentionally-empty first render before hydration has happened.
  const hydratedRef = useRef(false);

  useEffect(() => {
    setItems(readStoredCart());
    hydratedRef.current = true;
    setHydrated(true);
  }, []);

  // Keep storage in step with state, and adopt changes made in another tab so
  // two open tabs cannot silently overwrite each other's cart.
  useEffect(() => {
    if (!hydratedRef.current) return;
    writeStoredCart(items);
  }, [items]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      // Re-read rather than trusting event.newValue: it is null for a clear, and
      // running it through the same validator keeps one code path.
      setItems(readStoredCart());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addItem = useCallback((item: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) =>
          i.id === item.id
            ? { ...i, quantity: Math.min(MAX_QUANTITY, i.quantity + 1) }
            : i
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, quantity: Math.min(MAX_QUANTITY, quantity) } : i
        )
      );
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
        hydrated,
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
