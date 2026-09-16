import { useEffect, useState } from "react";
import { useNavigate, useParams, Link, useSearchParams } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { CheckCircle, Banknote, XCircle, Loader2, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

interface OrderPayment {
  payment_method: string;
  payment_status: string;
}

const OrderConfirmation = () => {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const paymentParam = searchParams.get("payment");
  const [order, setOrder] = useState<OrderPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (authLoading || !orderId || !user) return;
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
    void load();
    const interval = paymentParam === "success" ? window.setInterval(load, 3000) : undefined;
    const stop = window.setTimeout(() => interval && window.clearInterval(interval), 30000);
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [authLoading, orderId, paymentParam, user]);

  const retryPayment = async () => {
    if (!orderId) return;
    setActionLoading(true);
    const { data, error } = await supabase.functions.invoke("create-ikhokha-payment", {
      body: { orderId, returnOrigin: window.location.origin },
    });
    setActionLoading(false);
    const paylinkUrl = (data as { paylinkUrl?: string } | null)?.paylinkUrl;
    if (error || !paylinkUrl) {
      toast.error("Could not start card payment. Please try again later.");
      return;
    }
    window.location.assign(paylinkUrl);
  };

  const switchToCash = async () => {
    if (!orderId) return;
    setActionLoading(true);
    const { error } = await supabase.rpc("switch_order_to_cash", { _order_id: orderId });
    setActionLoading(false);
    if (error) {
      toast.error(error.message || "Could not switch this order to cash");
      return;
    }
    setOrder({ payment_method: "cash", payment_status: "pending" });
    navigate(`/order-confirmation/${orderId}`, { replace: true });
    toast.success("You can pay cash when your order arrives.");
  };

  const isCash = order?.payment_method === "cash";
  const isPaid = order?.payment_status === "paid";
  const isFailed = order?.payment_status === "failed" || paymentParam === "failed" || paymentParam === "cancelled";
  const failed = isFailed && !isPaid;
  const showCardActions = Boolean(order && !isCash && !isPaid && (failed || order.payment_status === "pending"));

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto flex flex-col items-center justify-center px-4 py-24 text-center">
        {authLoading || (user && loading) ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your order…
          </p>
        ) : !user ? (
          <>
            <h1 className="font-display text-3xl font-bold text-foreground">Sign in to view this order</h1>
            <Button asChild className="mt-6"><Link to="/auth">Sign In</Link></Button>
          </>
        ) : !order ? (
          <>
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-10 w-10 text-destructive" />
            </div>
            <h1 className="font-display text-3xl font-bold text-foreground">Order not found</h1>
            <p className="mt-3 max-w-md text-muted-foreground">This order does not exist or is not available to your account.</p>
            <Button asChild className="mt-8"><Link to="/">Back to Home</Link></Button>
          </>
        ) : (
          <>
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

            {failed ? (
              <p className="mt-3 max-w-md text-muted-foreground">
                Your order is saved. Retry card payment or switch to cash on delivery below.
              </p>
            ) : isCash ? (
              <p className="mt-3 max-w-md text-muted-foreground">
                Your order has been placed. Please have <span className="font-medium text-foreground">cash ready</span> for the driver on delivery.
              </p>
            ) : isPaid ? (
              <p className="mt-3 max-w-md text-muted-foreground">
                Payment received. The restaurant has been notified and is preparing your order.
              </p>
            ) : (
              <p className="mt-3 max-w-md text-muted-foreground">
                Your order has been placed. We’re confirming your card payment — this usually takes a few seconds.
              </p>
            )}

            <p className="mt-3 text-sm text-muted-foreground">
              Order ID: <span className="font-mono font-medium text-foreground">{orderId?.slice(0, 8)}…</span>
            </p>

            {showCardActions && (
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button onClick={() => { void retryPayment(); }} disabled={actionLoading}>
                  <CreditCard className="mr-2 h-4 w-4" /> Retry Card Payment
                </Button>
                <Button variant="outline" onClick={() => { void switchToCash(); }} disabled={actionLoading}>
                  <Banknote className="mr-2 h-4 w-4" /> Switch to Cash
                </Button>
              </div>
            )}

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild variant="outline"><Link to="/my-orders">View My Orders</Link></Button>
              <Button asChild><Link to="/">Back to Home</Link></Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default OrderConfirmation;
