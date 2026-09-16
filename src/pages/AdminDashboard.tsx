import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UtensilsCrossed, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import RestaurantManager from "@/components/admin/RestaurantManager";
import DelivererManager from "@/components/admin/DelivererManager";

interface Order extends Tables<"orders"> {
  order_items: Tables<"order_items">[];
}

interface Deliverer {
  user_id: string;
  full_name: string | null;
}

const ORDER_STATUSES = [
  "New",
  "Accepted",
  "Preparing",
  "Ready",
  "Picked Up",
  "On the Way",
  "Delivered",
  "Cancelled",
];

const statusColors: Record<string, string> = {
  New: "bg-accent text-accent-foreground",
  Accepted: "bg-secondary text-secondary-foreground",
  Preparing: "bg-secondary text-secondary-foreground",
  Ready: "bg-primary text-primary-foreground",
  "Picked Up": "bg-primary text-primary-foreground",
  "On the Way": "bg-primary text-primary-foreground",
  Delivered: "bg-green-100 text-green-800",
  Cancelled: "bg-destructive/10 text-destructive",
};

const AdminDashboard = () => {
  const { isAuthenticated, loading: authLoading, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [deliverers, setDeliverers] = useState<Deliverer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeliverers = useCallback(async () => {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "deliverer");
    const userIds = (roles || []).map((role) => role.user_id);
    if (userIds.length === 0) {
      setDeliverers([]);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    setDeliverers(
      userIds.map((userId) => ({
        user_id: userId,
        full_name: profiles?.find((profile) => profile.id === userId)?.full_name || null,
      })),
    );
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data: ordersData, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch orders");
      setLoading(false);
      return;
    }

    const orderIds = (ordersData || []).map((order) => order.id);
    const { data: itemData } = orderIds.length
      ? await supabase.from("order_items").select("*").in("order_id", orderIds)
      : { data: [] as Tables<"order_items">[] };

    const itemsByOrder = new Map<string, Tables<"order_items">[]>();
    (itemData || []).forEach((item) => {
      const items = itemsByOrder.get(item.order_id) || [];
      items.push(item);
      itemsByOrder.set(item.order_id, items);
    });

    setOrders(
      (ordersData || []).map((order) => ({
        ...order,
        order_items: itemsByOrder.get(order.id) || [],
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/admin/login");
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchOrders();
    void fetchDeliverers();

    const channel = supabase
      .channel("admin-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => { void fetchOrders(); },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [isAuthenticated, fetchDeliverers, fetchOrders]);

  const updateStatus = async (orderId: string, newStatus: string) => {
    const { error } = await supabase.rpc("update_order_status", {
      _order_id: orderId,
      _new_status: newStatus,
    });

    if (error) {
      toast.error(error.message || "Failed to update status");
      return;
    }
    toast.success(`Order marked as "${newStatus}"`);
    setOrders((prev) => prev.map((order) => (
      order.id === orderId ? { ...order, status: newStatus } : order
    )));
  };

  const assignDeliverer = async (orderId: string, delivererId: string) => {
    const { error } = await supabase.rpc("assign_order_deliverer", {
      _order_id: orderId,
      _deliverer_id: delivererId === "unassigned" ? null : delivererId,
    });

    if (error) {
      toast.error(error.message || "Failed to assign deliverer");
      return;
    }
    const nextDelivererId = delivererId === "unassigned" ? null : delivererId;
    setOrders((prev) => prev.map((order) => (
      order.id === orderId ? { ...order, deliverer_id: nextDelivererId } : order
    )));
    toast.success(nextDelivererId ? "Deliverer assigned" : "Deliverer unassigned");
  };

  const markPaid = async (orderId: string) => {
    const { error } = await supabase.rpc("mark_order_paid", { _order_id: orderId });
    if (error) {
      toast.error(error.message || "Failed to mark as paid");
      return;
    }
    toast.success("Payment recorded");
    setOrders((prev) => prev.map((order) => (
      order.id === orderId
        ? { ...order, payment_status: "paid", paid_at: new Date().toISOString() }
        : order
    )));
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="h-7 w-7 text-primary" />
            <span className="font-display text-xl font-bold text-foreground">Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { void fetchOrders(); void fetchDeliverers(); }}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { void logout(); navigate("/admin/login"); }}
            >
              <LogOut className="mr-1 h-4 w-4" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="orders">
          <TabsList className="mb-6">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="restaurants">Restaurants & Menus</TabsTrigger>
            <TabsTrigger value="deliverers">Deliverers</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <h1 className="mb-6 font-display text-3xl font-bold text-foreground">Orders</h1>
            {loading ? (
              <p className="text-muted-foreground">Loading orders...</p>
            ) : orders.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-lg text-muted-foreground">No orders yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">Orders placed by customers will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Driver</TableHead>
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
                          <p className="truncate text-sm">
                            {order.order_items.map((item) => `${item.quantity}× ${item.item_name}`).join(", ")}
                          </p>
                        </TableCell>
                        <TableCell className="font-semibold">
                          R {Number(order.total).toFixed(2)}
                          <div className="mt-1 flex items-center gap-1 text-xs font-normal">
                            <span className="text-muted-foreground">
                              {order.payment_method === "cash" ? "Cash" : "Card"}
                            </span>
                            <Badge
                              variant="outline"
                              className={
                                order.payment_status === "paid"
                                  ? "border-green-200 bg-green-100 text-green-800"
                                  : order.payment_status === "failed"
                                    ? "border-destructive/20 bg-destructive/10 text-destructive"
                                    : ""
                              }
                            >
                              {order.payment_status === "paid" ? "Paid" : order.payment_status === "failed" ? "Failed" : "Unpaid"}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColors[order.status] || ""} variant="secondary">{order.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={order.deliverer_id || "unassigned"}
                            onValueChange={(value) => { void assignDeliverer(order.id, value); }}
                          >
                            <SelectTrigger className="w-[150px]" aria-label={`Assign driver for order ${order.id.slice(0, 8)}`}>
                              <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {deliverers.map((deliverer) => (
                                <SelectItem key={deliverer.user_id} value={deliverer.user_id}>
                                  {deliverer.full_name || `${deliverer.user_id.slice(0, 8)}…`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleString("en-ZA")}
                        </TableCell>
                        <TableCell className="space-y-2 text-right">
                          <Select value={order.status} onValueChange={(value) => { void updateStatus(order.id, value); }}>
                            <SelectTrigger className="w-[150px]" aria-label={`Update status for order ${order.id.slice(0, 8)}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ORDER_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>{status}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {order.payment_status !== "paid" && (
                            <Button size="sm" variant="ghost" onClick={() => { void markPaid(order.id); }}>
                              Mark Paid
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

          <TabsContent value="restaurants">
            <h1 className="mb-6 font-display text-3xl font-bold text-foreground">Restaurants & Menus</h1>
            <RestaurantManager />
          </TabsContent>

          <TabsContent value="deliverers">
            <h1 className="mb-6 font-display text-3xl font-bold text-foreground">Deliverers</h1>
            <DelivererManager />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminDashboard;
