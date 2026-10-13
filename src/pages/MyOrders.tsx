import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Package, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { backendEnabled, fetchOrders as fetchBackendOrders } from "@/lib/backend";

interface OrderItem {
  id: string;
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
  "Ready for Pickup/Delivery": "bg-primary text-primary-foreground",
};

const MyOrders = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const fetchOrders = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (backendEnabled) {
        const data = await fetchBackendOrders();
        const mapped: Order[] = data.map((o: any) => ({
          id: o.id,
          restaurant_name: o.restaurant_name,
          subtotal: o.subtotal,
          delivery_fee: o.delivery_fee,
          total: o.total,
          status: o.status,
          payment_method: o.payment_method,
          payment_status: o.payment_status,
          created_at: o.created_at,
          delivery_address: o.delivery_address,
          order_items: (o.order_items || o.items || []).map((i: any) => ({
            id: i.id,
            item_name: i.item_name,
            item_price: i.item_price,
            quantity: i.quantity,
          })),
        }));
        setOrders(mapped);
      } else {
        const { data } = await supabase
          .from("orders")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        const withItems: Order[] = await Promise.all(
          (data || []).map(async (order) => {
            const { data: items } = await supabase
              .from("order_items")
              .select("*")
              .eq("order_id", order.id);
            return { ...order, order_items: items || [] } as Order;
          })
        );
        setOrders(withItems);
      }
    } catch (e) {
      console.error("Failed to fetch orders", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchOrders();
  }, [user]);

  // Realtime or polling
  useEffect(() => {
    if (!user) return;
    if (backendEnabled) {
      const interval = setInterval(fetchOrders, 5000);
      return () => clearInterval(interval);
    } else {
      const channel = supabase
        .channel("my-orders")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` }, () => fetchOrders())
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [user]);

  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="font-display text-3xl font-bold text-foreground mb-6">
          My Orders {backendEnabled && <span className="text-sm font-normal text-green-600">(backend)</span>}
        </h1>

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
