import { supabase } from "@/integrations/supabase/client";

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
