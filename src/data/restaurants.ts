import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

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

type RestaurantRow = Tables<"restaurants">;
type MenuItemRow = Tables<"menu_items">;

export async function fetchRestaurants(): Promise<Restaurant[]> {
  const { data: restaurants, error: restaurantError } = await supabase
    .from("restaurants")
    .select("*")
    .order("id");

  if (restaurantError) throw restaurantError;
  if (!restaurants) return [];

  const { data: menuItems, error: menuError } = await supabase
    .from("menu_items")
    .select("*");

  if (menuError) throw menuError;

  return restaurants.map((restaurant) =>
    mapRestaurant(
      restaurant,
      (menuItems || []).filter((menuItem) => menuItem.restaurant_id === restaurant.id),
    ),
  );
}

export async function fetchRestaurantById(id: number): Promise<Restaurant | null> {
  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (restaurantError) throw restaurantError;
  if (!restaurant) return null;

  const { data: menuItems, error: menuError } = await supabase
    .from("menu_items")
    .select("*")
    .eq("restaurant_id", id);

  if (menuError) throw menuError;

  return mapRestaurant(restaurant, menuItems || []);
}

function mapRestaurant(restaurant: RestaurantRow, items: MenuItemRow[]): Restaurant {
  return {
    id: restaurant.id,
    name: restaurant.name,
    cuisine: restaurant.cuisine,
    rating: Number(restaurant.rating),
    image: restaurant.image_url || "/placeholder.svg",
    deliveryTime: restaurant.delivery_time,
    menu: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      category: item.category,
    })),
  };
}
