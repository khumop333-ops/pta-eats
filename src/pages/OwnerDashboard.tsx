import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MenuItemManager from "@/components/admin/MenuItemManager";
import { LogOut, Star, Clock, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";

interface RestaurantRow {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  delivery_time: string;
  image_url: string;
}

interface OrderRow {
  id: string;
  customer_name: string;
  phone_number: string;
  delivery_address: string;
  special_instructions: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  created_at: string;
  order_items?: { id: string; item_name: string; item_price: number; quantity: number }[];
}

const STATUSES = ["New", "Preparing", "Ready", "Picked Up", "On the Way", "Delivered"];

const statusVariant = (status: string) =>
  status === "New" ? "default" : status === "Delivered" ? "secondary" : "outline";

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<RestaurantRow | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const loadOrders = async (restaurantId: number) => {
    const { data } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    setOrders((data as unknown as OrderRow[]) || []);
  };

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/owner/login");
        return;
      }

      const { data: rest } = await supabase
        .from("restaurants")
        .select("*")
        .eq("owner_id", session.user.id)
        .maybeSingle();

      if (!rest) {
        setRestaurant(null);
        setLoading(false);
        return;
      }

      setRestaurant(rest as RestaurantRow);
      await loadOrders(rest.id);
      setLoading(false);

      channel = supabase
        .channel(`owner-orders-${rest.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${rest.id}` },
          () => loadOrders(rest.id)
        )
        .subscribe();
    };

    init();

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [navigate]);

  const updateStatus = async (orderId: string, status: string) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    if (error) { toast.error("Could not update the order"); return; }
    toast.success(`Order marked ${status}`);
    if (restaurant) loadOrders(restaurant.id);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/owner/login");
  };

  if (loading) {
    return <div className="min-h-screen bg-background p-6 text-muted-foreground">Loading your restaurant...</div>;
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-lg space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold text-foreground">No restaurant linked</h1>
          <p className="text-sm text-muted-foreground">
            This account isn't linked to a restaurant yet. Ask the Roma team to link it, then sign in again.
          </p>
          <Button variant="outline" onClick={handleLogout}>Sign out</Button>
        </div>
      </div>
    );
  }

  const newCount = orders.filter((o) => o.status === "New").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="relative h-40 overflow-hidden md:h-52">
        {restaurant.image_url && (
          <img src={restaurant.image_url} alt={restaurant.name} className="h-full w-full object-cover" />
        )}
        <div className="hero-overlay absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 md:p-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-primary-foreground md:text-3xl">{restaurant.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-primary-foreground/80">
              <span className="flex items-center gap-1"><Star className="h-3 w-3" /> {restaurant.rating}</span>
              <span>{restaurant.cuisine}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {restaurant.delivery_time}</span>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={handleLogout}>
            <LogOut className="mr-1 h-3 w-3" /> Sign out
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders">Orders {newCount > 0 && `(${newCount} new)`}</TabsTrigger>
            <TabsTrigger value="menu">Menu</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-4 space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              orders.map((order) => (
                <Card key={order.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground">{order.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.created_at).toLocaleString("en-ZA")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
                      <Badge variant="outline">
                        {order.payment_method === "cash" ? "Cash" : "Card"} ·{" "}
                        {order.payment_status === "paid" ? "Paid" : "Unpaid"}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-sm">
                    {(order.order_items || []).map((item) => (
                      <div key={item.id} className="flex justify-between text-muted-foreground">
                        <span>{item.quantity} × {item.item_name}</span>
                        <span>R {(Number(item.item_price) * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-1 font-medium text-foreground">
                      <span>Total (incl. delivery)</span>
                      <span>R {Number(order.total).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1"><Phone className="h-3 w-3" /> {order.phone_number}</p>
                    <p className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {order.delivery_address}</p>
                    {order.special_instructions && <p className="italic">“{order.special_instructions}”</p>}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {STATUSES.filter((s) => s !== order.status).map((s) => (
                      <Button key={s} size="sm" variant="outline" onClick={() => updateStatus(order.id, s)}>
                        {s}
                      </Button>
                    ))}
                  </div>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="menu" className="mt-4">
            <MenuItemManager restaurantId={restaurant.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
