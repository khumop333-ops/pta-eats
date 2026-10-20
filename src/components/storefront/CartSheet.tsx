import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/context/CartContext";
import { DELIVERY_FEE, OPENING_HOURS_LABEL, isOpenNow } from "@/lib/business";

const formatRand = (value: number) => `R ${value.toFixed(2)}`;

type CartSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown under the heading; falls back to whatever is in the cart. */
  restaurantName?: string | null;
};

/**
 * The one cart drawer for the public restaurant page. Items are only ever
 * added from the page itself, so there is no need for a separate checkout
 * basket UI to stay in sync.
 */
const CartSheet = ({ open, onOpenChange, restaurantName }: CartSheetProps) => {
  const { items, updateQuantity, removeItem, subtotal, itemCount } = useCart();
  const navigate = useNavigate();
  const closed = !isOpenNow();
  const total = useMemo(() => subtotal + DELIVERY_FEE, [subtotal]);

  const goToCheckout = () => {
    onOpenChange(false);
    navigate("/checkout");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5 text-left">
          <SheetTitle className="font-display text-xl">Your cart</SheetTitle>
          <SheetDescription>
            {restaurantName || "Roma order"} · {itemCount} {itemCount === 1 ? "item" : "items"}
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <ShoppingCart aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Your cart is empty</p>
            <p className="text-xs text-muted-foreground">
              Add dishes from the menu to start your order.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id} className="rounded-xl bg-muted/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name} from cart`}
                      className="rounded-md p-1 text-destructive/70 transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        aria-label={`Decrease quantity of ${item.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md border bg-card text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium" aria-live="polite">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        aria-label={`Increase quantity of ${item.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md border bg-card text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {formatRand(item.price * item.quantity)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {items.length > 0 ? (
          <SheetFooter className="border-t p-5">
            <dl className="w-full space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatRand(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivery fee</dt>
                <dd>{formatRand(DELIVERY_FEE)}</dd>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-bold">
                <dt>Total</dt>
                <dd>{formatRand(total)}</dd>
              </div>
            </dl>

            <Button className="w-full" size="lg" onClick={goToCheckout} disabled={closed}>
              {closed ? "Closed" : "Card or cash checkout"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {closed
                ? `Ordering opens again ${OPENING_HOURS_LABEL}.`
                : "Or order on WhatsApp — no account needed."}
            </p>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default CartSheet;
