import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { CheckCircle, Banknote, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const OrderConfirmation = () => {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const paymentParam = searchParams.get("payment");
  const [order, setOrder] = useState<{ payment_method: string; payment_status: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("orders")
        .select("payment_method, payment_status")
        .eq("id", orderId)
        .maybeSingle();
      if (active) {
        setOrder(data ?? null);
        setLoading(false);
      }
    };
    load();
    // Card payments confirm via webhook, so poll briefly after returning from iKhokha
    const interval = paymentParam === "success" ? setInterval(load, 3000) : undefined;
    const stop = setTimeout(() => interval && clearInterval(interval), 30000);
    return () => {
      active = false;
      if (interval) clearInterval(interval);
      clearTimeout(stop);
    };
  }, [orderId, paymentParam]);

  const isCash = order?.payment_method === "cash";
  const isPaid = order?.payment_status === "paid";
  const isFailed = order?.payment_status === "failed" || paymentParam === "failed" || paymentParam === "cancelled";

  const failed = isFailed && !isPaid;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto flex flex-col items-center justify-center px-4 py-24 text-center">
        <div
          className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
            failed ? "bg-destructive/10" : "bg-secondary/20"
          }`}
        >
          {failed ? (
            <XCircle className="h-10 w-10 text-destructive" />
          ) : isCash ? (
            <Banknote className="h-10 w-10 text-secondary" />
          ) : (
            <CheckCircle className="h-10 w-10 text-secondary" />
          )}
        </div>

        <h1 className="font-display text-3xl font-bold text-foreground">
          {failed ? "Payment Not Completed" : "Thank You for Your Order!"}
        </h1>

        {loading ? (
          <p className="mt-3 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your order…
          </p>
        ) : failed ? (
          <p className="mt-3 max-w-md text-muted-foreground">
            Your order is saved but the card payment didn’t go through. You can pay cash on delivery,
            or contact us to retry the payment.
          </p>
        ) : isCash ? (
          <p className="mt-3 max-w-md text-muted-foreground">
            Your order has been placed. Please have{" "}
            <span className="font-medium text-foreground">cash ready</span> for the driver on delivery.
          </p>
        ) : isPaid ? (
          <p className="mt-3 max-w-md text-muted-foreground">
            Payment received. The restaurant has been notified and is preparing your order.
          </p>
        ) : (
          <p className="mt-3 max-w-md text-muted-foreground">
            Your order has been placed. We’re confirming your card payment — this usually takes a few
            seconds.
          </p>
        )}

        <p className="mt-3 text-sm text-muted-foreground">
          Order ID: <span className="font-mono font-medium text-foreground">{orderId?.slice(0, 8)}…</span>
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link to="/my-orders">View My Orders</Link>
          </Button>
          <Button asChild>
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </main>
    </div>
  );
};

export default OrderConfirmation;
