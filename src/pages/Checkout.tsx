import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CreditCard, Banknote, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { fetchServiceAvailability, quoteOrder } from "@/data/orders/transitions";
import {
  type QuoteResult,
  type ServiceAvailability,
  closedMessage,
  formatZAR,
  quoteErrorMessage,
} from "@/domain/order/pricing";

// DELIVERY_FEE used to live here as `const DELIVERY_FEE = 15` — one of four copies
// of the same number (this file, create-order, orders.delivery_fee, and
// orders.delivery_fee_cents). The client no longer computes money at all: the
// totals below are rendered from the server quote produced by quote_order(),
// which is the same function that prices the order at placement. They cannot
// diverge, because there is only one of them.

type PaymentMethod = "card" | "cash";

const Checkout = () => {
  const { items, clearCart } = useCart();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    address: "",
    instructions: "",
  });


  // Redirect to auth if not logged in
  useEffect(() => {
    if (!user) {
      toast.error("Please sign in to checkout");
      navigate("/auth");
    }
  }, [user, navigate]);

  // Pre-fill from profile
  useEffect(() => {
    if (profile) {
      setForm((prev) => ({
        ...prev,
        fullName: profile.full_name || prev.fullName,
        phone: profile.phone_number || prev.phone,
      }));
    }
  }, [profile]);

  // ---- Server-authoritative quote -----------------------------------------
  // Refetched whenever the basket changes, so the customer never sees a stale
  // price. The quote also carries the service-window state, which is why the
  // closed banner cannot disagree with what the Pay button does.
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [service, setService] = useState<ServiceAvailability | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchServiceAvailability().then((s) => { if (!cancelled) setService(s); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (items.length === 0) { setQuote(null); return; }
    let cancelled = false;
    setQuoteLoading(true);
    quoteOrder(items.map((i) => ({ menuItemId: i.id, quantity: i.quantity })))
      .then((q) => { if (!cancelled) setQuote(q); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [items]);

  const priced = quote?.ok ? quote : null;
  const closedNotice = service ? closedMessage(service) : null;
  // Blocking on the quote is deliberate: placing an order whose price we have not
  // confirmed is worse than making the customer wait a beat.
  const canSubmit = Boolean(priced) && priced?.canPlaceOrder !== false && !quoteLoading;

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto flex flex-col items-center justify-center py-24 text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">Your cart is empty</h1>
          <p className="mt-2 text-muted-foreground">Add some items before checking out.</p>
          <Button className="mt-6" onClick={() => navigate("/")}>Browse Restaurants</Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Prices and totals are calculated on the server from the live menu.
    const { data: created, error: createError } = await supabase.functions.invoke("create-order", {
      body: {
        customerName: form.fullName,
        phone: form.phone,
        address: form.address,
        instructions: form.instructions || null,
        paymentMethod,
        zone: priced?.zone ?? "central",
        items: items.map((item) => ({ menuItemId: item.id, quantity: item.quantity })),
      },
    });

    const orderId = (created as { orderId?: string } | null)?.orderId;

    if (createError || !orderId) {
      const details =
        createError instanceof FunctionsHttpError
          ? await createError.context.text()
          : createError?.message;
      console.error("create-order failed:", details);
      // A closed storefront is a 409 with a specific code; show the real reason
      // rather than a generic failure the customer cannot act on.
      let message = "Failed to place order. Please try again.";
      try {
        const parsed = JSON.parse(String(details));
        if (parsed?.code === "service_closed") message = "We're closed right now.";
        else if (typeof parsed?.error === "string") message = parsed.error;
      } catch { /* non-JSON error body — keep the generic message */ }
      toast.error(message);
      setLoading(false);
      return;
    }

    if (paymentMethod === "card") {
      const { data, error } = await supabase.functions.invoke("create-ikhokha-payment", {
        body: { orderId, returnOrigin: window.location.origin },
      });

      if (error) {
        const details =
          error instanceof FunctionsHttpError ? await error.context.text() : error.message;
        console.error("create-ikhokha-payment failed:", details);
        toast.error("Could not start card payment. Your order was saved — you can pay cash on delivery.");
        clearCart();
        navigate(`/order-confirmation/${orderId}?payment=failed`);
        return;
      }

      clearCart();
      window.location.href = (data as { paylinkUrl: string }).paylinkUrl;
      return;
    }

    clearCart();
    navigate(`/order-confirmation/${orderId}`);
  };



  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <h1 className="font-display text-3xl font-bold text-foreground mb-8">Checkout</h1>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Delivery Form */}
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Delivery Details</CardTitle>
            </CardHeader>
            <CardContent>
              <form id="checkout-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder="e.g. Thabo Mokoena"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 012 345 6789"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Delivery Address (Pretoria Central)</Label>
                  <Input
                    id="address"
                    required
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="e.g. 123 Church Street, Arcadia"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="instructions">Special Instructions (optional)</Label>
                  <Textarea
                    id="instructions"
                    value={form.instructions}
                    onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                    placeholder="e.g. Ring the buzzer at gate"
                    rows={3}
                  />
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Order Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>
                    {item.quantity}× {item.name}
                  </span>
                  <span className="font-medium">
                    {/* Rendered from the server line total when available, so the
                        per-line figures cannot contradict the summary below. */}
                    {formatZAR(
                      priced?.items.find((l) => l.menuItemId === item.id)?.lineTotalCents ??
                        Math.round(item.price * 100) * item.quantity
                    )}
                  </span>
                </div>
              ))}

              <Separator />

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{priced ? formatZAR(priced.subtotalCents) : "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Delivery{priced ? ` · ${priced.zoneLabel}` : ""}
                </span>
                <span>{priced ? formatZAR(priced.deliveryFeeCents) : "—"}</span>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Payment Method</Label>
                <RadioGroup
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                  className="gap-2"
                >
                  <label
                    htmlFor="pay-card"
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      paymentMethod === "card" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <RadioGroupItem value="card" id="pay-card" className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <CreditCard className="h-4 w-4" />
                        Pay by Card
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Secure card payment via iKhokha
                      </p>
                    </div>
                  </label>

                  <label
                    htmlFor="pay-cash"
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      paymentMethod === "cash" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <RadioGroupItem value="cash" id="pay-cash" className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Banknote className="h-4 w-4" />
                        Cash on Delivery
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Pay the driver in cash when your food arrives
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              </div>

              <Separator />

              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{priced ? formatZAR(priced.totalCents) : "—"}</span>
              </div>

              {/* Service window and pricing failures. Both are rendered from
                  server state, so they cannot contradict what submission does. */}
              {closedNotice && (
                <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <p className="text-foreground">{closedNotice}</p>
                </div>
              )}

              {quote && !quote.ok && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <p className="text-foreground">{quoteErrorMessage(quote)}</p>
                </div>
              )}

              <Button
                type="submit"
                form="checkout-form"
                className="w-full mt-4"
                size="lg"
                disabled={loading || !canSubmit}
              >
                {loading
                  ? paymentMethod === "card"
                    ? "Redirecting to payment…"
                    : "Placing Order..."
                  : quoteLoading
                    ? "Checking your total…"
                    : !priced
                      ? "Checking your total…"
                      : paymentMethod === "card"
                        ? `Pay ${formatZAR(priced.totalCents)}`
                        : `Place Order · ${formatZAR(priced.totalCents)}`}
              </Button>

            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Checkout;
