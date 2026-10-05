import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { claimOrder, transitionOrderStatus } from "@/data/orders/transitions";
import {
  TONE_CLASS,
  actionLabel,
  assertOrderStatus,
  isActive,
  nextStatusesFor,
  statusLabel,
  statusTone,
  type OrderStatus,
} from "@/domain/order/status";
import { toast } from "sonner";
import { Truck, MapPin, Phone, User, Package, LogOut, Navigation } from "lucide-react";

interface OrderItem {
  id: string;
  item_name: string;
  item_price: number;
  quantity: number;
}

interface Order {
  id: string;
  customer_name: string;
  phone_number: string;
  delivery_address: string;
  restaurant_name: string;
  status: OrderStatus;
  total: number;
  subtotal: number;
  delivery_fee: number;
  special_instructions: string | null;
  created_at: string;
  items: OrderItem[];
}

// Status presentation now comes from the domain module (statusTone + TONE_CLASS)
// so that all three dashboards agree on wording and colour. The previous local
// switch referenced "On the Way", a status that does not exist in the database.

const DelivererDashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/deliverer/login");
      return;
    }

    // Verify deliverer role
    const checkRole = async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "deliverer")
        .maybeSingle();

      if (!data) {
        toast.error("Access denied");
        navigate("/deliverer/login");
        return;
      }
      setHasAccess(true);
    };
    checkRole();
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!hasAccess) return;
    fetchOrders();

    // Realtime subscription
    const channel = supabase
      .channel("deliverer-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [hasAccess]);

  const fetchOrders = async () => {
    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (!ordersData) { setLoading(false); return; }

    const { data: allItems } = await supabase
      .from("order_items")
      .select("*");

    // Narrow status at the trust boundary. The database CHECK constraint makes
    // this total; if it ever throws, the client and schema have drifted apart
    // and we want to know loudly rather than render a wrong status.
    const mapped: Order[] = ordersData.map((o) => ({
      ...o,
      status: assertOrderStatus(o.status, "order"),
      items: (allItems || []).filter((i) => i.order_id === o.id),
    }));

    setOrders(mapped);
    setLoading(false);
  };

  // Goes through the database state machine. A direct UPDATE would be silently
  // dropped by RLS or rejected by the transition trigger.
  const updateStatus = async (orderId: string, newStatus: OrderStatus) => {
    const result = await transitionOrderStatus(orderId, newStatus);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Order marked ${statusLabel(newStatus).toLowerCase()}`);
    fetchOrders();
  };

  const handleClaim = async (orderId: string) => {
    const result = await claimOrder(orderId);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Job claimed");
    fetchOrders();
  };

  const openMaps = (address: string) => {
    const encoded = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encoded}`, "_blank");
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/deliverer/login");
  };

  if (authLoading || !hasAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // isActive() also treats cancelled and failed as finished. The old
  // `status !== "Delivered"` check counted a cancelled order as still active
  // and would have nagged a rider about it indefinitely.
  const activeOrders = orders.filter((o) => isActive(o.status));
  const completedOrders = orders.filter((o) => !isActive(o.status));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            <h1 className="font-display text-xl font-bold text-foreground">Deliveries</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-1 h-4 w-4" /> Logout
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <p className="text-muted-foreground text-center py-12">Loading orders...</p>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <Package className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No orders yet</p>
          </div>
        ) : (
          <>
            {/* Active Orders */}
            {activeOrders.length > 0 && (
              <section>
                <h2 className="font-display text-lg font-semibold text-foreground mb-3">
                  Active Orders ({activeOrders.length})
                </h2>
                <div className="space-y-4">
                  {activeOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onUpdateStatus={updateStatus}
                      onOpenMaps={openMaps}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed */}
            {completedOrders.length > 0 && (
              <section>
                <h2 className="font-display text-lg font-semibold text-muted-foreground mb-3">
                  Completed ({completedOrders.length})
                </h2>
                <div className="space-y-4">
                  {completedOrders.slice(0, 10).map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onUpdateStatus={updateStatus}
                      onOpenMaps={openMaps}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
};

function OrderCard({
  order,
  onUpdateStatus,
  onOpenMaps,
}: {
  order: Order;
  onUpdateStatus: (id: string, status: OrderStatus) => void;
  onOpenMaps: (address: string) => void;
}) {
  const isCompleted = !isActive(order.status);

  return (
    <Card className={isCompleted ? "opacity-70" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold">{order.restaurant_name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(order.created_at).toLocaleString()}
            </p>
          </div>
          <Badge variant="outline" className={TONE_CLASS[statusTone(order.status)]}>
            {statusLabel(order.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Customer info */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-foreground font-medium">{order.customer_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
            <a href={`tel:${order.phone_number}`} className="text-primary hover:underline">
              {order.phone_number}
            </a>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-foreground">{order.delivery_address}</span>
          </div>
        </div>

        {/* Navigate button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onOpenMaps(order.delivery_address)}
        >
          <Navigation className="mr-2 h-4 w-4" />
          Open in Google Maps
        </Button>

        {/* Order items */}
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Order Items</p>
          <div className="space-y-1">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-foreground">
                  {item.quantity}× {item.item_name}
                </span>
                <span className="text-muted-foreground">R {(item.item_price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span>R {Number(order.total).toFixed(2)}</span>
          </div>
        </div>

        {/* Special instructions */}
        {order.special_instructions && (
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
            <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-1">Special Instructions</p>
            <p className="text-sm text-foreground">{order.special_instructions}</p>
          </div>
        )}

        {/* Status actions.
            This replaces a free-choice Select that listed every status, including
            "On the Way" (which does not exist) and "Delivered" — meaning a rider
            could mark an order delivered without ever confirming pickup. The
            buttons below are derived from the same transition table the database
            enforces, so the UI cannot offer a step the server will reject. */}
        {!isCompleted && nextStatusesFor(order.status, "deliverer").length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {nextStatusesFor(order.status, "deliverer").map((next) => (
              <Button
                key={next}
                size="sm"
                variant={next === "failed" ? "outline" : "default"}
                onClick={() => onUpdateStatus(order.id, next)}
              >
                {actionLabel(next)}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DelivererDashboard;
