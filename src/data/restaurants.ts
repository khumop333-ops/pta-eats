import { supabase } from "@/integrations/supabase/client";
import { backendEnabled, fetchRestaurantsFromBackend, fetchRestaurantByIdFromBackend } from "@/lib/backend";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
}

export interface Restaurant {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  image: string;
  deliveryTime: string;
  menu: MenuItem[];
}

export async function fetchRestaurants(): Promise<Restaurant[]> {
  // Try fresh backend first if enabled
  if (backendEnabled) {
    try {
      const data = await fetchRestaurantsFromBackend();
      // Need menu items for each restaurant - fetch in parallel
      const enriched = await Promise.all(
        data.map(async (r) => {
          try {
            const full = await fetchRestaurantByIdFromBackend(r.id);
            return mapBackendRestaurant(full);
          } catch {
            return mapBackendRestaurant({ ...r, menu: [] } as any);
          }
        })
      );
      if (enriched.length > 0) return enriched;
    } catch (e) {
      console.warn("Backend fetch failed, falling back to Supabase", e);
    }
  }

  const { data: restaurants, error: rErr } = await supabase
    .from("restaurants")
    .select("*")
    .order("id");

  if (rErr || !restaurants) return [];

  const { data: menuItems, error: mErr } = await supabase
    .from("menu_items")
    .select("*");

  if (mErr) return restaurants.map((r) => mapRestaurant(r, []));

  return restaurants.map((r) =>
    mapRestaurant(
      r,
      (menuItems || []).filter((m) => m.restaurant_id === r.id)
    )
  );
}

export async function fetchRestaurantById(id: number): Promise<Restaurant | null> {
  if (backendEnabled) {
    try {
      const r = await fetchRestaurantByIdFromBackend(id);
      return mapBackendRestaurant(r);
    } catch (e) {
      console.warn("Backend fetch by id failed, fallback", e);
    }
  }

  const { data: r, error: rErr } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", id)
    .single();

  if (rErr || !r) return null;

  const { data: menuItems } = await supabase
    .from("menu_items")
    .select("*")
    .eq("restaurant_id", id);

  return mapRestaurant(r, menuItems || []);
}

function mapRestaurant(r: any, items: any[]): Restaurant {
  return {
    id: r.id,
    name: r.name,
    cuisine: r.cuisine,
    rating: Number(r.rating),
    image: r.image_url || "/placeholder.svg",
    deliveryTime: r.delivery_time,
    menu: items.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      price: Number(m.price),
      category: m.category,
    })),
  };
}

function mapBackendRestaurant(r: any): Restaurant {
  return {
    id: r.id,
    name: r.name,
    cuisine: r.cuisine,
    rating: Number(r.rating),
    image: r.image_url || "/placeholder.svg",
    deliveryTime: r.delivery_time || r.deliveryTime || "20-30 min",
    menu: (r.menu || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      price: Number(m.price),
      category: m.category,
    })),
  };
}
