import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type SupabaseRestaurant = Database["public"]["Tables"]["restaurants"]["Row"];
type SupabaseMenuItem = Database["public"]["Tables"]["menu_items"]["Row"];

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

// Keep the homepage usable even when Supabase is not configured/reachable.
// These are the demo restaurants used for local development.
const fallbackRestaurants: Restaurant[] = [
  {
    id: 1,
    name: "Mama's Kitchen",
    cuisine: "South African",
    rating: 4.8,
    image: "/restaurant-1.jpg",
    deliveryTime: "25-35 min",
    menu: [
      { id: "fallback-mama-pap-wors", name: "Pap & Wors", description: "Traditional pap with boerewors and chakalaka", price: 85, category: "Mains" },
      { id: "fallback-mama-bunny-chow", name: "Bunny Chow", description: "Durban style bunny chow with chicken curry", price: 95, category: "Mains" },
      { id: "fallback-mama-bobotie", name: "Bobotie", description: "Cape Malay bobotie with yellow rice", price: 110, category: "Mains" },
      { id: "fallback-mama-malva-pudding", name: "Malva Pudding", description: "Warm malva pudding with custard", price: 45, category: "Desserts" },
      { id: "fallback-mama-rooibos-tea", name: "Rooibos Iced Tea", description: "Refreshing rooibos iced tea", price: 25, category: "Drinks" },
    ],
  },
  {
    id: 2,
    name: "Pretoria Grill House",
    cuisine: "Grill & BBQ",
    rating: 4.6,
    image: "/restaurant-2.jpg",
    deliveryTime: "20-30 min",
    menu: [
      { id: "fallback-grill-tbone", name: "T-Bone Steak 500g", description: "Grilled T-bone with chips and salad", price: 185, category: "Grill" },
      { id: "fallback-grill-wors-roll", name: "Boerewors Roll", description: "Boerewors roll with caramelized onions", price: 65, category: "Grill" },
      { id: "fallback-grill-platter", name: "Mixed Grill Platter", description: "Steak, wors, chicken, chips for 2", price: 295, category: "Platters" },
      { id: "fallback-grill-garlic-bread", name: "Garlic Bread", description: "Freshly baked garlic bread", price: 35, category: "Sides" },
      { id: "fallback-grill-coke", name: "Coke 330ml", description: "Coca Cola", price: 20, category: "Drinks" },
    ],
  },
  {
    id: 3,
    name: "Cape Town Fish & Chips",
    cuisine: "Seafood",
    rating: 4.7,
    image: "/restaurant-3.jpg",
    deliveryTime: "30-40 min",
    menu: [
      { id: "fallback-fish-hake-chips", name: "Hake & Chips", description: "Battered hake with chips and tartar sauce", price: 95, category: "Mains" },
      { id: "fallback-fish-calamari", name: "Calamari & Chips", description: "Crispy calamari rings with chips", price: 110, category: "Mains" },
      { id: "fallback-fish-burger", name: "Fish Burger", description: "Grilled fish burger with slaw", price: 75, category: "Burgers" },
      { id: "fallback-fish-platter", name: "Seafood Platter", description: "Prawns, calamari, fish, chips", price: 245, category: "Platters" },
    ],
  },
  {
    id: 4,
    name: "Roma Italian",
    cuisine: "Italian",
    rating: 4.9,
    image: "/hero-food.jpg",
    deliveryTime: "20-35 min",
    menu: [
      { id: "fallback-roma-margherita", name: "Margherita Pizza", description: "Tomato, mozzarella, basil", price: 120, category: "Pizza" },
      { id: "fallback-roma-carbonara", name: "Spaghetti Carbonara", description: "Creamy carbonara with bacon", price: 135, category: "Pasta" },
      { id: "fallback-roma-lasagna", name: "Lasagna", description: "Beef lasagna with bechamel", price: 145, category: "Pasta" },
      { id: "fallback-roma-tiramisu", name: "Tiramisu", description: "Classic tiramisu", price: 55, category: "Desserts" },
      { id: "fallback-roma-espresso", name: "Espresso", description: "Double shot espresso", price: 30, category: "Drinks" },
    ],
  },
];

function copyFallbackRestaurant(restaurant: Restaurant): Restaurant {
  return { ...restaurant, menu: restaurant.menu.map((item) => ({ ...item })) };
}

function getFallbackRestaurants(): Restaurant[] {
  return fallbackRestaurants.map(copyFallbackRestaurant);
}

function getFallbackRestaurantById(id: number): Restaurant | null {
  const restaurant = fallbackRestaurants.find((candidate) => candidate.id === id);
  return restaurant ? copyFallbackRestaurant(restaurant) : null;
}

function resolveImageUrl(imageUrl?: string | null): string {
  if (!imageUrl?.trim()) return "/placeholder.svg";

  // Older seeded databases stored Vite source paths, which are not public URLs.
  const legacyAssetPath = imageUrl.trim().match(/^\/?src\/assets\/(.+)$/);
  return legacyAssetPath ? `/${legacyAssetPath[1]}` : imageUrl.trim();
}

export async function fetchRestaurants(): Promise<Restaurant[]> {
  try {
    const { data: restaurants, error: restaurantError } = await supabase
      .from("restaurants")
      .select("*")
      .order("id");

    if (restaurantError || !restaurants?.length) {
      return getFallbackRestaurants();
    }

    const { data: menuItems, error: menuError } = await supabase
      .from("menu_items")
      .select("*");

    if (menuError) return restaurants.map((restaurant) => mapRestaurant(restaurant, []));

    return restaurants.map((restaurant) =>
      mapRestaurant(
        restaurant,
        (menuItems || []).filter((item) => item.restaurant_id === restaurant.id),
      ),
    );
  } catch (error) {
    console.warn("Restaurant fetch failed, using local fallback data", error);
    return getFallbackRestaurants();
  }
}

export async function fetchRestaurantById(id: number): Promise<Restaurant | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;

  try {
    const { data: restaurant, error: restaurantError } = await supabase
      .from("restaurants")
      .select("*")
      .eq("id", id)
      .single();

    if (restaurantError || !restaurant) return getFallbackRestaurantById(id);

    const { data: menuItems } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", id);

    return mapRestaurant(restaurant, menuItems || []);
  } catch (error) {
    console.warn("Restaurant lookup failed, using local fallback data", error);
    return getFallbackRestaurantById(id);
  }
}

function mapRestaurant(restaurant: SupabaseRestaurant, items: SupabaseMenuItem[]): Restaurant {
  return {
    id: restaurant.id,
    name: restaurant.name,
    cuisine: restaurant.cuisine,
    rating: Number(restaurant.rating),
    image: resolveImageUrl(restaurant.image_url),
    deliveryTime: restaurant.delivery_time || "20-30 min",
    menu: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      category: item.category,
    })),
  };
}
