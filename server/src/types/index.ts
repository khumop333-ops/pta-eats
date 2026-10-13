export type AppRole = 'admin' | 'deliverer' | 'restaurant_owner' | 'user';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  phone_number: string | null;
  role: AppRole;
  created_at: string;
}

export interface Restaurant {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  image_url: string;
  delivery_time: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  customer_name: string;
  phone_number: string;
  delivery_address: string;
  special_instructions: string | null;
  restaurant_id: number;
  restaurant_name: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  payment_reference: string | null;
  paid_at: string | null;
  user_id: string | null;
  deliverer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
}
