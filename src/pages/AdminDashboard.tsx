import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  restaurant_name: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  created_at: string;
  order_items: OrderItem[];
  deliverer_id: string | null;
  assignee_name: string | null;
}

interface Deliverer {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  New: "bg-accent text-accent-foreground",
  Accepted: "bg-secondary text-secondary-foreground",
  "Ready for Pickup/Delivery": "bg-primary text-primary-foreground",
};

const AdminDashboard = () => {
  const { isAuthenticated, loading: authLoading, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignmentOrder, setAssignmentOrder] = useState<Order | null>(null);
  const [deliverers, setDeliverers] = useState<Deliverer[]>([]);
  const [loadingDeliverers, setLoadingDeliverers] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/admin/login");
    }
  }, [isAuthenticated, authLoading, navigate]);

  const fetchOrders = async () => {
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

    const assigneeIds = [...new Set((ordersData || []).flatMap((o) => o.deliverer_id ? [o.deliverer_id] : []))];
    const assigneeNames = new Map<string, string>();
    if (assigneeIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", assigneeIds);
      if (profilesError) toast.error(profilesError.message);
      for (const profile of profiles || []) {
        if (profile.full_name) assigneeNames.set(profile.id, profile.full_name);
      }
    }

    const ordersWithItems: Order[] = await Promise.all(
      (ordersData || []).map(async (order) => {
        const { data: items } = await supabase
          .from("order_items")
          .select("*")
          .eq("order_id", order.id);
        return {
          ...order,
          order_items: items || [],
          assignee_name: assigneeNames.get(order.deliverer_id) || null,
        };
      })
    );

    setOrders(ordersWithItems);
    setLoading(false);
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrders();

    const channel = supabase
      .channel("admin-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => { fetchOrders(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated]);

  const openAssignment = async (order: Order) => {
    if (!isAuthenticated || assigning || loadingDeliverers) return;
    setAssignmentOrder(order);
    setDeliverers([]);
    setLoadingDeliverers(true);
    try {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "deliverer");
      if (rolesError) throw rolesError;
      const ids = [...new Set((roles || []).map((role) => role.user_id))];
      if (ids.length === 0) return;

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      if (profilesError) throw profilesError;
      const names = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
      setDeliverers(ids.map((id) => ({ id, name: names.get(id) || `Unnamed (${id})` })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String((error as { message?: string })?.message || error));
      setAssignmentOrder(null);
    } finally {
      setLoadingDeliverers(false);
    }
  };

  const assignDeliverer = async (deliverer: Deliverer) => {
    if (!isAuthenticated || !assignmentOrder || assigning) return;
    setAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("assign-deliverer", {
        body: { order_id: assignmentOrder.id, deliverer_id: deliverer.id },
      });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json();
          throw new Error(typeof body?.error === "string" ? body.error : error.message);
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      if (data?.ok !== true) throw new Error("Failed to assign deliverer");

      toast.success(`Assigned to ${deliverer.name}`);
      setAssignmentOrder(null);
      await fetchOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign deliverer");
    } finally {
      setAssigning(false);
    }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success(`Order marked as "${newStatus}"`);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
    }
  };

  const markPaid = async (orderId: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .eq("id", orderId);

    if (error) {
      toast.error("Failed to mark as paid");
    } else {
      toast.success("Payment recorded");
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, payment_status: "paid" } : o))
      );
    }
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
            <span className="font-display text-xl font-bold text-foreground">
              Dashboard
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchOrders}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { logout(); navigate("/admin/login"); }}
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
            <h1 className="font-display text-3xl font-bold text-foreground mb-6">Orders</h1>
            {loading ? (
              <p className="text-muted-foreground">Loading orders...</p>
            ) : orders.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-lg text-muted-foreground">No orders yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">Orders placed by customers will appear here.</p>
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
                      <TableHead>Deliverer</TableHead>
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
                          {order.deliverer_id ? order.assignee_name || order.deliverer_id : "Unassigned"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleString("en-ZA")}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button size="sm" variant="outline" disabled={assigning || loadingDeliverers} onClick={() => openAssignment(order)}>
                            Assign deliverer
                          </Button>
                          {order.status === "New" && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(order.id, "Accepted")}>Accept</Button>
                          )}
                          {(order.status === "New" || order.status === "Accepted") && (
                            <Button size="sm" onClick={() => updateStatus(order.id, "Ready for Pickup/Delivery")}>Ready</Button>
                          )}
                          {order.payment_status !== "paid" && (
                            <Button size="sm" variant="ghost" onClick={() => markPaid(order.id)}>Mark Paid</Button>
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
            <h1 className="font-display text-3xl font-bold text-foreground mb-6">Restaurants & Menus</h1>
            <RestaurantManager />
          </TabsContent>

          <TabsContent value="deliverers">
            <h1 className="font-display text-3xl font-bold text-foreground mb-6">Deliverers</h1>
            <DelivererManager />
          </TabsContent>
        </Tabs>
      </main>
      <Dialog open={assignmentOrder !== null} onOpenChange={(open) => { if (!open && !assigning) setAssignmentOrder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign deliverer</DialogTitle>
            <DialogDescription>
              Order {assignmentOrder?.id.slice(0, 8)} — Current assignee: {assignmentOrder?.deliverer_id
                ? assignmentOrder.assignee_name || assignmentOrder.deliverer_id
                : "Unassigned"}. Select a deliverer to assign or reassign this order.
            </DialogDescription>
          </DialogHeader>
          {loadingDeliverers ? (
            <p className="text-muted-foreground">Loading deliverers...</p>
          ) : deliverers.length === 0 ? (
            <p className="text-muted-foreground">No deliverers available.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {deliverers.map((deliverer) => (
                <Button key={deliverer.id} variant="outline" className="w-full justify-start" disabled={assigning} onClick={() => assignDeliverer(deliverer)}>
                  {deliverer.name}{deliverer.id === assignmentOrder?.deliverer_id ? " (current)" : ""}
                </Button>
              ))}
            </div>
          )}
          {assigning && <p role="status" className="text-muted-foreground">Assigning deliverer...</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;
