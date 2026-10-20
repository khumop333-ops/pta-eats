import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { track } from "@vercel/analytics";
import { Banknote, CheckCircle2, Copy, Landmark, MessageCircle, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/context/CartContext";
import { CLOSED_MESSAGE, DELIVERY_FEE, OPENING_HOURS_LABEL, isOpenNow } from "@/lib/business";
import { buildWhatsAppLink, openWhatsApp } from "@/lib/whatsapp";
import { BANK_TRANSFER_DETAILS, hasBankTransferDetails } from "@/config/bankTransfer";
import StorefrontPageHeader from "@/components/storefront/StorefrontPageHeader";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";

const formatRand = (value: number) => `R ${value.toFixed(2)}`;

/**
 * The live checkout: no account, no payment-method question, no database
 * order. The customer fills in their delivery details, sees how to pay by bank
 * transfer or cash, and is handed to WhatsApp with one itemised message that
 * already includes the delivery fee.
 *
 * The legacy `/checkout` page (Yoco card + cash, writes an order to Supabase)
 * is still routed and still in the repo, but nothing in the storefront links
 * to it any more — it is reachable by direct URL only.
 */
const WhatsAppCheckout = () => {
  const { items, subtotal, itemCount, clearCart, restaurantName, restaurantSlug } = useCart();
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    address: "",
    instructions: "",
  });
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [wasBlocked, setWasBlocked] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const closed = !isOpenNow();
  const total = subtotal + DELIVERY_FEE;
  const bankDetailsReady = hasBankTransferDetails();
  const menuHref = restaurantSlug ? `/r/${restaurantSlug}` : "/r";

  // The customer's own name and number double as the payment reference, so
  // Roma can match an incoming transfer to a WhatsApp message.
  const paymentReference = [form.fullName.trim(), form.phone.trim()].filter(Boolean).join(" ");

  const bankRows = useMemo(
    () => [
      { label: "Account holder", value: BANK_TRANSFER_DETAILS.accountHolder },
      { label: "Bank", value: BANK_TRANSFER_DETAILS.bankName },
      { label: "Account number", value: BANK_TRANSFER_DETAILS.accountNumber },
      { label: "Branch code", value: BANK_TRANSFER_DETAILS.branchCode },
      { label: "Payment reference", value: paymentReference },
    ],
    [paymentReference],
  );

  const copyToClipboard = async (label: string, value: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopiedLabel(label);
      toast.success(`${label} copied`);
    } catch {
      // Older/in-app browsers: ask the customer to copy by hand rather than
      // pretending it worked.
      toast.error(`Couldn't copy automatically — please select the ${label.toLowerCase()} and copy it.`);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (closed) {
      toast.error(CLOSED_MESSAGE);
      return;
    }

    if (items.length === 0) return;

    // `required` handles this in normal browsers, but some in-app browsers
    // (WhatsApp's, Facebook's) submit anyway — and an order without a phone
    // number or address is useless to the kitchen.
    if (!form.fullName.trim() || !form.phone.trim() || !form.address.trim()) {
      toast.error("Please add your name, phone number and delivery address so Roma can reach you.");
      return;
    }

    const link = buildWhatsAppLink({
      restaurantName: restaurantName ?? "Roma",
      restaurantSlug,
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        priceCents: Math.round(item.price * 100),
      })),
      deliveryFeeCents: Math.round(DELIVERY_FEE * 100),
      customer: {
        name: form.fullName,
        phone: form.phone,
        address: form.address,
        notes: form.instructions,
      },
      // No payment question is asked: both options stay open in the message.
      paymentMethod: "either",
    });

    track("whatsapp_click", {
      restaurant_slug: restaurantSlug ?? undefined,
      source: "checkout",
      item_count: itemCount,
      cart_value: Number(subtotal.toFixed(2)),
    });

    if (!link) {
      toast.error("WhatsApp isn't available right now. Please try again in a moment.");
      return;
    }

    const opened = openWhatsApp(link);
    // Keep the built link: the cart is cleared, so the confirmation screen is
    // the only route back to the exact message if WhatsApp was blocked.
    setSentLink(link);
    setWasBlocked(!opened);
    clearCart();
  };

  const shell = (children: ReactNode) => (
    <div className="roma-surface flex min-h-screen flex-col">
      <StorefrontPageHeader backTo={menuHref} backLabel="Back to menu" />
      <main className="container mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">{children}</main>
      <StorefrontFooter />
    </div>
  );

  if (sentLink) {
    return shell(
      <section className="roma-card mx-auto max-w-xl p-6 text-center md:p-8" aria-live="polite">
        <CheckCircle2 aria-hidden="true" className="mx-auto h-12 w-12 text-primary" />
        <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Your order is ready</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          We opened WhatsApp with your full order, delivery fee and payment details already filled
          in. <span className="font-medium text-foreground">Press send there</span> and Roma will
          confirm your delivery.
        </p>

        {wasBlocked ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            Your browser blocked the WhatsApp window. Tap the button below to send your order — the
            message is already written.
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3">
          <Button asChild size="lg" className="gap-2">
            <a href={sentLink} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
              Message Roma on WhatsApp again
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link to="/r">Browse restaurants</Link>
          </Button>
        </div>
      </section>,
    );
  }

  if (items.length === 0) {
    return shell(
      <div className="mx-auto max-w-xl text-center">
        <ShoppingBag aria-hidden="true" className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">Add some dishes, then come back to check out.</p>
        <Button asChild className="mt-6">
          <Link to="/r">Browse restaurants</Link>
        </Button>
      </div>,
    );
  }

  return shell(
    <>
      <p className="roma-eyebrow">Almost there</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Checkout</h1>
      <p className="mt-2 text-muted-foreground">
        No account needed. Fill in your details, then send the order to Roma on WhatsApp.
      </p>

      {closed ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {CLOSED_MESSAGE}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className="roma-card p-5 md:p-6" aria-labelledby="delivery-heading">
            <h2 id="delivery-heading" className="font-display text-xl font-semibold text-foreground">
              Delivery details
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Roma uses these to reach you and to find your address.
            </p>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  name="name"
                  autoComplete="name"
                  required
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="e.g. Thabo Mokoena"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  name="tel"
                  type="tel"
                  autoComplete="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g. 072 123 4567"
                />
                <p className="text-xs text-muted-foreground">
                  Roma calls this number if the driver can’t find you.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Delivery address</Label>
                <Input
                  id="address"
                  name="street-address"
                  autoComplete="street-address"
                  required
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="e.g. 123 Church Street, Arcadia, Pretoria"
                />
                <p className="text-xs text-muted-foreground">
                  Include the street, suburb and anything the driver needs.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="instructions">Special instructions (optional)</Label>
                <Textarea
                  id="instructions"
                  name="notes"
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                  placeholder="e.g. Ring the buzzer at the gate"
                  rows={3}
                />
              </div>
            </div>
          </section>

          <section className="roma-card p-5 md:p-6" aria-labelledby="payment-heading">
            <h2 id="payment-heading" className="font-display text-xl font-semibold text-foreground">
              How you can pay
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose whichever suits you — tell Roma in the WhatsApp message and we’ll confirm.
            </p>

            <div className="mt-5" role="group" aria-labelledby="bank-transfer-heading">
              <h3
                id="bank-transfer-heading"
                className="flex items-center gap-2 font-semibold text-foreground"
              >
                <Landmark aria-hidden="true" className="h-5 w-5 text-primary" />
                Pay by bank transfer
              </h3>

              {bankDetailsReady ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Transfer the total, then send proof of payment on WhatsApp.
                  </p>

                  <dl className="mt-3 divide-y divide-border rounded-xl border bg-muted/40 px-3">
                    {bankRows.map(({ label, value }) => (
                      <div
                        key={label}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            {label}
                          </dt>
                          <dd
                            className={`mt-0.5 break-words font-medium ${
                              value ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {value || "Your name and phone number"}
                          </dd>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!value}
                          onClick={() => copyToClipboard(label, value)}
                          aria-label={`Copy ${label.toLowerCase()}`}
                          className="shrink-0 gap-1 text-muted-foreground"
                        >
                          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                          <span className="sr-only sm:not-sr-only">
                            {copiedLabel === label ? "Copied" : "Copy"}
                          </span>
                        </Button>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <div className="mt-2 rounded-xl border border-dashed bg-muted/40 p-4">
                  <p className="text-sm font-medium text-foreground">
                    Bank details coming soon
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Roma is still setting up the business account. You can pay cash when your food
                    arrives, or ask us for the account number in the WhatsApp message.
                  </p>
                </div>
              )}
            </div>

            <Separator className="my-5" />

            <div role="group" aria-labelledby="cash-heading">
              <h3 id="cash-heading" className="flex items-center gap-2 font-semibold text-foreground">
                <Banknote aria-hidden="true" className="h-5 w-5 text-primary" />
                Cash on delivery
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Pay the driver when your food arrives — please have{" "}
                <span className="font-medium text-foreground">{formatRand(total)}</span> ready.
              </p>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <section className="roma-card p-5" aria-labelledby="summary-heading">
            <h2 id="summary-heading" className="font-display text-xl font-semibold text-foreground">
              Your order
            </h2>
            {restaurantName ? (
              <p className="mt-1 text-sm text-muted-foreground">From {restaurantName}</p>
            ) : null}

            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 text-foreground">
                    {item.quantity}× {item.name}
                  </span>
                  <span className="shrink-0 font-medium text-foreground">
                    {formatRand(item.price * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <Separator className="my-4" />

            <dl className="space-y-1 text-sm">
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

            <Button type="submit" size="lg" className="mt-5 w-full gap-2" disabled={closed}>
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
              {closed ? "Closed" : "Send order on WhatsApp"}
            </Button>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              {closed
                ? `Ordering opens again ${OPENING_HOURS_LABEL}.`
                : "WhatsApp opens with your order already written. Nothing is charged until you send it."}
            </p>
          </section>
        </aside>
      </form>
    </>,
  );
};

export default WhatsAppCheckout;
