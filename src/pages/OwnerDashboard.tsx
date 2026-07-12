import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Store, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import MenuItemManager from "@/components/admin/MenuItemManager";

interface Restaurant {
  id: number;
  name: string;
  cuisine: string;
  delivery_time: string;
}

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
  special_instructions: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
  created_at: string;
  order_items: OrderItem[];
}

const statusColors: Record<string, string> = {
  New: "bg-accent text-accent-foreground",
  Accepted: "bg-secondary text-secondary-foreground",
  "Ready for Pickup/Delivery": "bg-primary text-primary-foreground",
};

const OwnerDashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/owner/login");
      return;
    }

    (async () => {
      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "restaurant_owner" as any)
        .maybeSingle();

      if (!role) {
        toast.error("Access denied");
        navigate("/owner/login");
        return;
      }

      const { data: rest } = await supabase
        .from("restaurants")
        .select("id, name, cuisine, delivery_time")
        .eq("owner_id", user.id)
        .maybeSingle();

      if (!rest) {
        toast.error("No restaurant assigned to your account. Contact the admin.");
        return;
      }
      setRestaurant(rest as Restaurant);
    })();
  }, [user, authLoading, navigate]);

  const fetchOrders = async () => {
    if (!restaurant) return;
    setLoading(true);
    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .order("created_at", { ascending: false });

    const withItems: Order[] = await Promise.all(
      (ordersData || []).map(async (o) => {
        const { data: items } = await supabase
          .from("order_items")
          .select("*")
          .eq("order_id", o.id);
        return { ...o, order_items: items || [] } as Order;
      })
    );
    setOrders(withItems);
    setLoading(false);
  };

  useEffect(() => {
    if (!restaurant) return;
    fetchOrders();

    const channel = supabase
      .channel(`owner-orders-${restaurant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurant.id}` },
        () => fetchOrders()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id]);

  const updateStatus = async (orderId: string, newStatus: string) => {
    const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", orderId);
    if (error) toast.error("Failed to update status");
    else {
      toast.success(`Order marked as "${newStatus}"`);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/owner/login");
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <Store className="h-12 w-12 text-muted-foreground/40" />
        <p className="text-muted-foreground text-center max-w-md">
          No restaurant is assigned to your account yet. Please contact the super admin.
        </p>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="mr-1 h-4 w-4" /> Sign Out
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Store className="h-7 w-7 text-primary" />
            <div>
              <p className="font-display text-lg font-bold leading-tight text-foreground">{restaurant.name}</p>
              <p className="text-xs text-muted-foreground leading-tight">{restaurant.cuisine}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchOrders}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="mr-1 h-4 w-4" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="orders">
          <TabsList className="mb-6">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="menu">My Menu</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <h1 className="font-display text-3xl font-bold text-foreground mb-6">Your Orders</h1>
            {loading ? (
              <p className="text-muted-foreground">Loading orders...</p>
            ) : orders.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-lg text-muted-foreground">No orders yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Orders for {restaurant.name} will appear here in real time.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border bg-card overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}…</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{order.customer_name}</p>
                            <p className="text-xs text-muted-foreground">{order.phone_number}</p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="text-sm truncate">
                            {order.order_items.map((i) => `${i.quantity}× ${i.item_name}`).join(", ")}
                          </p>
                        </TableCell>
                        <TableCell className="font-semibold">R {Number(order.total).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[order.status] || ""} variant="secondary">
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleString("en-ZA")}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          {order.status === "New" && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(order.id, "Accepted")}>
                              Accept
                            </Button>
                          )}
                          {(order.status === "New" || order.status === "Accepted") && (
                            <Button size="sm" onClick={() => updateStatus(order.id, "Ready for Pickup/Delivery")}>
                              Ready
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="menu">
            <h1 className="font-display text-3xl font-bold text-foreground mb-6">My Menu</h1>
            <MenuItemManager restaurantId={restaurant.id} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default OwnerDashboard;
