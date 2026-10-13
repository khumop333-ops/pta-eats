/**
 * Backend API client - talks to our fresh Express backend
 * Now the PRIMARY backend - Supabase is fallback/legacy
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

export function getAuthHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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

// Types
export interface BackendRestaurant {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  image_url: string;
  delivery_time: string;
  owner_id: string | null;
  created_at?: string;
  updated_at?: string;
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
  order_items?: { id: string; item_name: string; item_price: number; quantity: number; order_id: string; created_at: string }[];
  items?: { id: string; item_name: string; item_price: number; quantity: number }[];
}

export interface BackendUser {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  phone_number?: string | null;
  created_at?: string;
}

// Auth
export async function login(email: string, password: string): Promise<{ user: BackendUser; token: string }> {
  const res = await apiFetch<{ user: BackendUser; token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(res.token);
  return res;
}

export async function signup(email: string, password: string, full_name?: string, phone_number?: string): Promise<{ user: BackendUser; token: string }> {
  const res = await apiFetch<{ user: BackendUser; token: string }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, full_name, phone_number }),
  });
  setToken(res.token);
  return res;
}

export async function getMe(): Promise<BackendUser> {
  return apiFetch<BackendUser>('/auth/me');
}

export async function logout() {
  clearToken();
}

// Restaurants
export async function fetchRestaurantsFromBackend(): Promise<BackendRestaurant[]> {
  return apiFetch<BackendRestaurant[]>('/restaurants');
}

export async function fetchRestaurantByIdFromBackend(id: number): Promise<BackendRestaurant & { menu: BackendMenuItem[] }> {
  return apiFetch(`/restaurants/${id}`);
}

export async function createRestaurant(data: Partial<BackendRestaurant>): Promise<BackendRestaurant> {
  return apiFetch('/restaurants', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateRestaurant(id: number, data: Partial<BackendRestaurant>): Promise<BackendRestaurant> {
  return apiFetch(`/restaurants/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteRestaurant(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/restaurants/${id}`, { method: 'DELETE' });
}

// Menu
export async function fetchMenuItems(restaurantId?: number): Promise<BackendMenuItem[]> {
  const q = restaurantId ? `?restaurant_id=${restaurantId}` : '';
  return apiFetch(`/menu-items${q}`);
}

export async function createMenuItem(data: { restaurant_id: number; name: string; description: string; price: number; category: string }): Promise<BackendMenuItem> {
  return apiFetch('/menu-items', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMenuItem(id: string, data: Partial<BackendMenuItem>): Promise<BackendMenuItem> {
  return apiFetch(`/menu-items/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteMenuItem(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/menu-items/${id}`, { method: 'DELETE' });
}

// Orders
export async function createOrder(data: {
  customerName: string;
  phone: string;
  address: string;
  instructions?: string | null;
  paymentMethod: 'card' | 'cash';
  items: { menuItemId: string; quantity: number }[];
}): Promise<{ orderId: string; subtotal: number; deliveryFee: number; total: number }> {
  return apiFetch('/orders', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchOrders(): Promise<BackendOrder[]> {
  return apiFetch('/orders');
}

export async function fetchOrderById(id: string): Promise<BackendOrder> {
  return apiFetch(`/orders/${id}`);
}

export async function updateOrderStatus(id: string, status: string): Promise<BackendOrder> {
  return apiFetch(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export async function markOrderPaid(id: string): Promise<BackendOrder> {
  return apiFetch(`/orders/${id}/mark-paid`, { method: 'POST' });
}

// Payments
export async function createIkhokhaPayment(orderId: string, returnOrigin: string): Promise<{ paylinkUrl: string; mock?: boolean }> {
  return apiFetch('/payments/create-ikhokha-payment', {
    method: 'POST',
    body: JSON.stringify({ orderId, returnOrigin }),
  });
}

export async function mockConfirmPayment(orderId: string): Promise<{ success: boolean }> {
  return apiFetch(`/payments/mock-confirm/${orderId}`, { method: 'POST' });
}

// Admin
export async function createUser(data: { email: string; password: string; full_name?: string; role: 'deliverer' | 'restaurant_owner'; restaurant_id?: number }): Promise<{ user_id: string }> {
  return apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchStats(): Promise<{ totalOrders: number; totalRestaurants: number; totalMenuItems: number; totalUsers: number; ordersByStatus: any; revenue: number }> {
  return apiFetch('/admin/stats');
}

export async function fetchAllUsers(): Promise<BackendUser[]> {
  return apiFetch('/auth/users');
}

// Upload
export async function uploadRestaurantImage(file: File): Promise<{ url: string; publicUrl: string }> {
  const form = new FormData();
  form.append('file', file);
  // Need to bypass json content-type for FormData
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/uploads/restaurant-image`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || 'Upload failed');
  }
  return res.json();
}
