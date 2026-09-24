import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Package, Clock, ChevronDown, ChevronUp, Banknote, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface OrderItem {
  id: string;
  order_id: string;
  item_name: string;
  item_price: number;
  quantity: number;
}

interface Order {
  id: string;
  restaurant_name: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;

  created_at: string;
  delivery_address: string;
  order_items: OrderItem[];
}

const statusStyles: Record<string, string> = {
  New: "bg-accent text-accent-foreground",
  Accepted: "bg-secondary text-secondary-foreground",
  Preparing: "bg-secondary text-secondary-foreground",
  Ready: "bg-primary text-primary-foreground",
  "Picked Up": "bg-primary text-primary-foreground",
  "On the Way": "bg-primary text-primary-foreground",
  Delivered: "bg-green-100 text-green-800",
  Cancelled: "bg-destructive/10 text-destructive",
};

const MyOrders = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [paymentActionId, setPaymentActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Could not load your orders");
      setLoading(false);
      return;
    }

    const orderIds = (data || []).map((order) => order.id);
    const { data: items } = orderIds.length
      ? await supabase.from("order_items").select("*").in("order_id", orderIds)
      : { data: [] as OrderItem[] };
    const itemsByOrder = new Map<string, OrderItem[]>();
    (items || []).forEach((item) => {
      const existing = itemsByOrder.get(item.order_id) || [];
      existing.push(item);
      itemsByOrder.set(item.order_id, existing);
    });

    setOrders((data || []).map((order) => ({
      ...order,
      order_items: itemsByOrder.get(order.id) || [],
    })) as Order[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) void fetchOrders();
  }, [user, fetchOrders]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`my-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` },
        () => { void fetchOrders(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, fetchOrders]);

  const retryPayment = async (orderId: string) => {
    setPaymentActionId(orderId);
    const { data, error } = await supabase.functions.invoke("create-ikhokha-payment", {
      body: { orderId, returnOrigin: window.location.origin },
    });
    setPaymentActionId(null);
    const paylinkUrl = (data as { paylinkUrl?: string } | null)?.paylinkUrl;
    if (error || !paylinkUrl) {
      toast.error("Could not start card payment. Please try again later.");
      return;
    }
    window.location.assign(paylinkUrl);
  };

  const switchToCash = async (orderId: string) => {
    setPaymentActionId(orderId);
    const { error } = await supabase.rpc("switch_order_to_cash", { _order_id: orderId });
    setPaymentActionId(null);
    if (error) {
      toast.error(error.message || "Could not switch this order to cash");
      return;
    }
    setOrders((previous) => previous.map((order) => (
      order.id === orderId
        ? { ...order, payment_method: "cash", payment_status: "pending" }
        : order
    )));
    toast.success("You can pay cash when your order arrives.");
  };

  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="font-display text-3xl font-bold text-foreground mb-6">My Orders</h1>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <Package className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-lg text-muted-foreground">No orders yet</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
              Browse Restaurants
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const expanded = expandedId === order.id;
              return (
                <div key={order.id} className="rounded-lg border bg-card overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedId(expanded ? null : order.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{order.restaurant_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" />
                        {new Date(order.created_at).toLocaleString("en-ZA")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      <Badge className={statusStyles[order.status] || ""} variant="secondary">
                        {order.status}
                      </Badge>
                      <span className="font-semibold text-foreground whitespace-nowrap">
                        R {Number(order.total).toFixed(2)}
                      </span>
                      {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t px-4 py-3 space-y-2 bg-muted/30">
                      {order.order_items.map((item) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-foreground">{item.quantity}× {item.item_name}</span>
                          <span className="text-muted-foreground">R {(item.item_price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="border-t pt-2 mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>Delivery fee</span>
                        <span>R {Number(order.delivery_fee).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          {order.payment_method === "cash" ? "Cash on delivery" : "Card payment"}
                        </span>
                        <span
                          className={
                            order.payment_status === "paid"
                              ? "font-medium text-green-700"
                              : order.payment_status === "failed"
                                ? "font-medium text-destructive"
                                : "text-muted-foreground"
                          }
                        >
                          {order.payment_status === "paid"
                            ? "Paid"
                            : order.payment_status === "failed"
                              ? "Payment failed"
                              : order.payment_method === "cash"
                                ? "Pay on delivery"
                                : "Awaiting payment"}
                        </span>
                      </div>
                      {order.payment_method === "card" && order.payment_status !== "paid" && order.status !== "Delivered" && order.status !== "Cancelled" && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => { void retryPayment(order.id); }}
                            disabled={paymentActionId === order.id}
                          >
                            <CreditCard className="mr-1 h-3 w-3" /> Retry Card Payment
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { void switchToCash(order.id); }}
                            disabled={paymentActionId === order.id}
                          >
                            <Banknote className="mr-1 h-3 w-3" /> Switch to Cash
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">📍 {order.delivery_address}</p>
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default MyOrders;
