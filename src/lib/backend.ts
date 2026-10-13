/**
 * Backend API client - talks to our fresh Express backend
 * Falls back to Supabase if backend not available or VITE_USE_BACKEND=false
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === 'true' || import.meta.env.VITE_USE_BACKEND === '1';

function getToken(): string | null {
  return localStorage.getItem('pta-eats-token');
}

export function setToken(token: string) {
  localStorage.setItem('pta-eats-token', token);
}

export function clearToken() {
  localStorage.removeItem('pta-eats-token');
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as any),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = data?.error ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : `Request failed ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

// Check if backend is reachable
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE.replace('/api', '')}/health`, { method: 'GET' });
    if (res.ok) return true;
    const res2 = await fetch(`/health`);
    return res2.ok;
  } catch {
    return false;
  }
}

export const backendEnabled = USE_BACKEND;

export interface BackendRestaurant {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  image_url: string;
  delivery_time: string;
  owner_id: string | null;
  menu?: BackendMenuItem[];
}

export interface BackendMenuItem {
  id: string;
  restaurant_id: number;
  name: string;
  description: string;
  price: number;
  category: string;
}

export interface BackendOrder {
  id: string;
  customer_name: string;
  phone_number: string;
  delivery_address: string;
  restaurant_id: number;
  restaurant_name: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  created_at: string;
  order_items: { id: string; item_name: string; item_price: number; quantity: number }[];
}

// High level helpers that mirror supabase/data layer
export async function fetchRestaurantsFromBackend(): Promise<BackendRestaurant[]> {
  return apiFetch<BackendRestaurant[]>('/restaurants');
}

export async function fetchRestaurantByIdFromBackend(id: number): Promise<BackendRestaurant & { menu: BackendMenuItem[] }> {
  return apiFetch(`/restaurants/${id}`);
}
