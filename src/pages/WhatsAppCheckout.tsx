import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { track } from "@vercel/analytics";
import {
  Banknote,
  CheckCircle2,
  Copy,
  Gift,
  Landmark,
  Loader2,
  Lock,
  MessageCircle,
  ShieldCheck,
  ShoppingBag,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { PREORDER_MESSAGE, isOpenNow } from "@/lib/business";
import { openWhatsApp } from "@/lib/whatsapp";
import {
  placeDirectLockedOrder,
  type PlaceDirectOrderResult,
} from "@/lib/directOrder";
import {
  buildReferralShareUrl,
  buildReferralWhatsAppInviteLink,
} from "@/lib/referrals";
import { BANK_TRANSFER_DETAILS, hasBankTransferDetails } from "@/config/bankTransfer";
import { OrderReceiptCard } from "@/components/storefront/OrderReceiptCard";
import StorefrontPageHeader from "@/components/storefront/StorefrontPageHeader";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";

const formatRand = (value: number) => `R ${value.toFixed(2)}`;

/**
 * Live storefront checkout (/order): guest-friendly and signed-in friendly.
 *
 * Every order is priced and locked server-side via `placeDirectLockedOrder`
 * (never via an editable WhatsApp message), dispatched automatically to Roma,
 * and accompanied by a downloadable/shareable Official Receipt PNG image.
 */
const WhatsAppCheckout = () => {
  const { items, subtotal, deliveryFee, itemCount, clearCart, restaurantName, restaurantSlug } =
    useCart();
  const { user, profile, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    address: "",
    instructions: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [lockedOrder, setLockedOrder] = useState<PlaceDirectOrderResult | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  // Pre-fill name and phone from the signed-in customer's profile without
  // overwriting anything they already typed.
  useEffect(() => {
    if (!profile) return;
    setForm((prev) => ({
      ...prev,
      fullName: prev.fullName || profile.full_name || "",
      phone: prev.phone || profile.phone_number || "",
    }));
  }, [profile]);

  const closed = !isOpenNow();
  const availableCredits = user ? Math.max(0, profile?.free_delivery_credits ?? 0) : 0;
  const willUseFreeDelivery = Boolean(user && availableCredits > 0 && deliveryFee > 0);
  const effectiveDeliveryFee = willUseFreeDelivery ? 0 : deliveryFee;
  const total = subtotal + effectiveDeliveryFee;
  const bankDetailsReady = hasBankTransferDetails();
  const menuHref = restaurantSlug ? `/r/${restaurantSlug}` : "/r";
  const referralCode = profile?.referral_code?.trim() || "";

  const paymentReference = useMemo(() => {
    if (lockedOrder?.receipt.order_number) {
      return [lockedOrder.receipt.order_number, lockedOrder.receipt.customer_name]
        .filter(Boolean)
        .join(" · ");
    }
    return [form.fullName.trim(), form.phone.trim()].filter(Boolean).join(" ");
  }, [form.fullName, form.phone, lockedOrder]);

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
      toast.error(
        `Couldn't copy automatically — please select the ${label.toLowerCase()} and copy it.`,
      );
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (items.length === 0 || submitting) return;

    if (!form.fullName.trim() || !form.phone.trim() || !form.address.trim()) {
      toast.error("Please add your name, phone number and delivery address so Roma can reach you.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await placeDirectLockedOrder({
        customerName: form.fullName.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        instructions: form.instructions.trim() || null,
        items: items.map((item) => ({
          menuItemId: item.id,
          quantity: item.quantity,
        })),
      });

      track("order_placed", {
        restaurant_slug: result.receipt.restaurant_slug ?? restaurantSlug ?? undefined,
        order_number: result.receipt.order_number,
        item_count: itemCount,
        cart_value: Number(result.receipt.subtotal.toFixed(2)),
        total_value: Number(result.receipt.total.toFixed(2)),
        is_preorder: result.receipt.is_preorder,
      });

      if (user) {
        void refreshProfile();
      }

      setLockedOrder(result);
      clearCart();
      toast.success(`Order ${result.receipt.order_number} sent directly to Roma!`);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Could not submit your order right now. Please try again.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: ReactNode) => (
    <div className="roma-surface flex min-h-screen flex-col">
      <StorefrontPageHeader backTo={menuHref} backLabel="Back to menu" />
      <main className="container mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">
        {children}
      </main>
      <StorefrontFooter />
    </div>
  );

  if (lockedOrder) {
    const { receipt } = lockedOrder;

    return shell(
      <div className="mx-auto max-w-xl space-y-6">
        <section className="roma-card p-6 text-center md:p-8" aria-live="polite">
          <CheckCircle2 aria-hidden="true" className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 font-display text-2xl font-bold text-foreground">
            {receipt.is_preorder
              ? "Pre-order sent directly to Roma"
              : "Order sent directly to Roma"}
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            Your order <span className="font-semibold text-foreground">{receipt.order_number}</span>{" "}
            has been priced and locked on our server and delivered straight to Roma —{" "}
            {receipt.is_preorder
              ? "Roma will confirm availability and delivery after reopening at 08:00 SAST."
              : "no WhatsApp message or manual steps needed."}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Sent directly to Roma · Prices locked
            </span>

            {receipt.promo_code ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Gift aria-hidden="true" className="h-3.5 w-3.5" />
                Free delivery · Code {receipt.promo_code}
              </span>
            ) : null}
          </div>
        </section>

        <OrderReceiptCard receipt={receipt} />

        {bankDetailsReady ? (
          <section className="roma-card p-5 md:p-6" aria-labelledby="post-order-bank-heading">
            <h2
              id="post-order-bank-heading"
              className="flex items-center gap-2 font-display text-lg font-semibold text-foreground"
            >
              <Landmark aria-hidden="true" className="h-5 w-5 text-primary" />
              Paying by bank transfer (EFT)?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {receipt.is_preorder
                ? "Wait for Roma to confirm your pre-order after reopening before transferring payment."
                : `Transfer ${formatRand(receipt.total)} using ${receipt.order_number} as your reference, and share your Official Receipt PNG alongside your proof of payment.`}
            </p>

            <dl className="mt-3 divide-y divide-border rounded-xl border bg-muted/40 px-3">
              {bankRows.map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-0.5 break-words font-medium text-foreground">{value}</dd>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!value}
                    onClick={() => void copyToClipboard(label, value)}
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
          </section>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {user ? (
            <Button asChild variant="outline" className="flex-1">
              <Link to="/my-orders">Track in My Orders</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="flex-1">
            <Link to="/r">Browse restaurants</Link>
          </Button>
        </div>

        <section className="roma-card border-secondary/20 bg-secondary/5 p-5 md:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <Users aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-semibold text-foreground">
                {user ? "Want your next delivery free?" : "Get free deliveries when you sign up"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {user
                  ? "Invite friends to Roma — they get free delivery on their 1st order, and you earn 1 free delivery as soon as they order."
                  : "Create a free account to get your first signed-in delivery free and earn more free deliveries by referring friends."}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {user && referralCode ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => openWhatsApp(buildReferralWhatsAppInviteLink(referralCode))}
                      className="gap-1.5"
                    >
                      <MessageCircle aria-hidden="true" className="h-4 w-4" />
                      Invite on WhatsApp
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void copyToClipboard("Referral link", buildReferralShareUrl(referralCode))
                      }
                      className="gap-1.5"
                    >
                      <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                      Copy referral link
                    </Button>
                  </>
                ) : (
                  <Button asChild size="sm">
                    <Link to={user ? "/referrals" : "/auth?mode=signup"}>
                      {user ? "Open referrals" : "Sign up for free deliveries"}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>,
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
        {user
          ? "Confirm your delivery details below to send your locked order directly to Roma."
          : "No account needed. Fill in your details below and your locked order goes straight to Roma."}
      </p>

      {!user && deliveryFee > 0 ? (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/8 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Gift aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Sign up & get this delivery for FREE (save {formatRand(deliveryFee)})
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Your basket is saved — sign up in seconds for R0 first delivery, or check out as a
                guest below.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link to="/auth?mode=signup" state={{ from: "/order" }}>
              Sign up for free delivery
            </Link>
          </Button>
        </div>
      ) : null}

      {closed ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {PREORDER_MESSAGE}
        </p>
      ) : null}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
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
              Choose whichever suits you — your official locked receipt covers both options.
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
                    {closed
                      ? "Please wait for Roma to confirm your pre-order before transferring payment."
                      : "Transfer the locked total, then share your Official Receipt PNG alongside your proof of payment."}
                  </p>

                  <dl className="mt-3 divide-y divide-border rounded-xl border bg-muted/40 px-3">
                    {bankRows.map(({ label, value }) => (
                      <div key={label} className="flex items-start justify-between gap-3 py-2.5">
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
                          onClick={() => void copyToClipboard(label, value)}
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
                  <p className="text-sm font-medium text-foreground">Bank details coming soon</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Roma is still setting up the business account. You can pay cash when your food
                    arrives, or Roma will share EFT details once your order arrives.
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

            {willUseFreeDelivery ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                <Gift aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>
                  Free delivery applied! Saving {formatRand(deliveryFee)} ({availableCredits}{" "}
                  {availableCredits === 1 ? "credit" : "credits"} available)
                </span>
              </div>
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
                <dd>
                  {willUseFreeDelivery ? (
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

            <Button type="submit" size="lg" disabled={submitting} className="mt-5 w-full gap-2">
              {submitting ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Lock aria-hidden="true" className="h-4 w-4" />
              )}
              {submitting
                ? "Locking & sending order…"
                : closed
                  ? "Place pre-order"
                  : "Place order"}
            </Button>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              {closed
                ? "Your pre-order is locked on our server and sent straight to Roma for confirmation after reopening."
                : "Sent directly to Roma with server-locked prices — you will receive an official receipt image immediately."}
            </p>
          </section>
        </aside>
      </form>
    </>,
  );
};

export default WhatsAppCheckout;
