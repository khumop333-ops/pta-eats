import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Gift, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
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
import { useAuth } from "@/context/AuthContext";
import { PREORDER_MESSAGE, isOpenNow } from "@/lib/business";

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
  const { items, updateQuantity, removeItem, subtotal, deliveryFee, itemCount } = useCart();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const closed = !isOpenNow();

  const credits = Math.max(0, profile?.free_delivery_credits ?? 0);
  const hasFreeDelivery = Boolean(user && credits > 0 && deliveryFee > 0);
  const effectiveDeliveryFee = hasFreeDelivery ? 0 : deliveryFee;
  const total = useMemo(() => subtotal + effectiveDeliveryFee, [subtotal, effectiveDeliveryFee]);

  const goToCheckout = () => {
    onOpenChange(false);
    // /order is the live flow: bank transfer details + cash on delivery, sent
    // to Roma on WhatsApp. /checkout (card/cash, writes an order) is dormant.
    navigate("/order");
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
            {!user && deliveryFee > 0 ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5 text-foreground">
                  <Gift aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
                  First delivery FREE when you sign up
                </span>
                <Link
                  to="/auth?mode=signup"
                  state={{ from: "/order" }}
                  onClick={() => onOpenChange(false)}
                  className="shrink-0 font-semibold text-primary hover:underline"
                >
                  Sign up
                </Link>
              </div>
            ) : null}

            <dl className="w-full space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatRand(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivery fee</dt>
                <dd>
                  {hasFreeDelivery ? (
                    <span>
                      <span className="mr-1.5 line-through text-muted-foreground">
                        {formatRand(deliveryFee)}
                      </span>
                      <span className="font-semibold text-primary">FREE</span>
                    </span>
                  ) : (
                    formatRand(deliveryFee)
                  )}
                </dd>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-bold">
                <dt>Total</dt>
                <dd>{formatRand(total)}</dd>
              </div>
            </dl>

            <Button className="w-full" size="lg" onClick={goToCheckout}>
              {closed ? "Pre-order" : "Checkout"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {closed
                ? PREORDER_MESSAGE
                : hasFreeDelivery
                  ? "Your free delivery credit will be applied automatically."
                  : "Pay by bank transfer or cash on delivery — no account needed."}
            </p>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default CartSheet;
