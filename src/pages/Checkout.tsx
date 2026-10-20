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
import { CreditCard, Banknote } from "lucide-react";
import { toast } from "sonner";
import { DELIVERY_FEE, isOpenNow, CLOSED_MESSAGE } from "@/lib/business";
import { startYocoCheckout } from "@/lib/payments";

/**
 * DORMANT — legacy checkout (card via Yoco / cash, writes an order to Supabase).
 *
 * Since Oct 2026 the live flow is `/order` (WhatsAppCheckout): bank transfer or
 * cash on delivery, sent to Roma on WhatsApp with no database order. Nothing in
 * the storefront links here any more; this page is kept, routed and reachable by
 * direct URL only, along with all Yoco code, so it can be switched back on once
 * the Yoco keys are configured.
 */

type PaymentMethod = "card" | "cash";

const Checkout = () => {
  const { items, subtotal, clearCart } = useCart();
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    address: "",
    instructions: "",
  });


  // Wait until Supabase has restored the session before deciding whether to redirect.
  useEffect(() => {
    if (authLoading || user) return;

    toast.error("Please sign in to checkout");
    navigate("/auth", {
      replace: true,
      state: { from: "/checkout" },
    });
  }, [authLoading, user, navigate]);

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

  const total = subtotal + DELIVERY_FEE;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main
          className="container mx-auto flex items-center justify-center px-4 py-24"
          aria-busy="true"
        >
          <p role="status" className="text-muted-foreground">
            Checking your account…
          </p>
        </main>
      </div>
    );
  }

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
    if (!isOpenNow()) {
      toast.error(CLOSED_MESSAGE);
      return;
    }
    setLoading(true);

    // Prices and totals are calculated on the server from the live menu.
    const { data: created, error: createError } = await supabase.functions.invoke("create-order", {
      body: {
        customerName: form.fullName,
        phone: form.phone,
        address: form.address,
        instructions: form.instructions || null,
        paymentMethod,
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
      toast.error("Failed to place order. Please try again.");
      setLoading(false);
      return;
    }

    if (paymentMethod === "card") {
      try {
        const { redirectUrl } = await startYocoCheckout(orderId);
        clearCart();
        window.location.href = redirectUrl;
        return;
      } catch (error) {
        console.error("create-yoco-payment failed:", error);
        toast.error(
          "Could not start card payment. Your order was saved — you can retry the payment or pay cash on delivery.",
        );
        clearCart();
        navigate(`/order-confirmation/${orderId}?payment=failed`);
        return;
      }
    }

    clearCart();
    navigate(`/order-confirmation/${orderId}`);
  };



  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <h1 className="font-display text-3xl font-bold text-foreground mb-8">Checkout</h1>

        {!isOpenNow() && (
          <p role="alert" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {CLOSED_MESSAGE}
          </p>
        )}
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
                  <span className="font-medium">R {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}

              <Separator />

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>R {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Delivery Fee</span>
                <span>R {DELIVERY_FEE.toFixed(2)}</span>
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
                        Secure card payment via Yoco
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
                <span>R {total.toFixed(2)}</span>
              </div>

              <Button
                type="submit"
                form="checkout-form"
                className="w-full mt-4"
                size="lg"
                disabled={loading}
              >
                {loading
                  ? paymentMethod === "card"
                    ? "Redirecting to payment…"
                    : "Placing Order..."
                  : paymentMethod === "card"
                    ? `Pay R ${total.toFixed(2)}`
                    : "Place Order"}
              </Button>

            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Checkout;
