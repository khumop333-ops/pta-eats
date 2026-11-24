import { supabase } from "@/integrations/supabase/client";

export interface OrderReceiptItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  line_total: number;
}

export type NotificationChannelState = "sent" | "not_configured" | "failed";

export interface OrderNotificationSummary {
  live_admin: "delivered";
  whatsapp_cloud?: NotificationChannelState;
  email?: NotificationChannelState;
  telegram?: NotificationChannelState;
  webhook?: NotificationChannelState;
  dispatched_at?: string;
}

export interface OrderReceipt {
  order_id: string;
  order_number: string;
  receipt_token: string;
  customer_name: string;
  phone_number: string;
  delivery_address: string;
  special_instructions: string | null;
  restaurant_id: number;
  restaurant_name: string;
  restaurant_slug: string | null;
  subtotal: number;
  standard_delivery_fee: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  promo_code: string | null;
  is_preorder: boolean;
  created_at: string;
  items: OrderReceiptItem[];
}

export interface PlaceDirectOrderInput {
  customerName: string;
  phone: string;
  address: string;
  instructions?: string | null;
  origin?: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
  }>;
}

export interface PlaceDirectOrderResult {
  receipt: OrderReceipt;
  notifications: OrderNotificationSummary;
}

function toNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeOrderReceipt(raw: unknown): OrderReceipt {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid order receipt returned by server.");
  }

  const record = raw as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : [];

  const items: OrderReceiptItem[] = rawItems.map((entry, idx) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const price = toNumber(item.price, 0);
    const quantity = Math.max(1, Math.round(toNumber(item.quantity, 1)));
    return {
      id: typeof item.id === "string" && item.id ? item.id : `item-${idx}`,
      name: typeof item.name === "string" ? item.name : "Menu item",
      price,
      quantity,
      line_total:
        item.line_total !== undefined
          ? toNumber(item.line_total, price * quantity)
          : Math.round(price * quantity * 100) / 100,
    };
  });

  const deliveryFee = toNumber(record.delivery_fee, 0);
  const standardFee =
    record.standard_delivery_fee !== undefined && record.standard_delivery_fee !== null
      ? toNumber(record.standard_delivery_fee, deliveryFee)
      : deliveryFee;

  const orderId = typeof record.order_id === "string" ? record.order_id : String(record.id ?? "");
  const fallbackNumber = orderId ? `ROMA-${orderId.slice(0, 6).toUpperCase()}` : "ROMA-ORDER";

  return {
    order_id: orderId,
    order_number:
      typeof record.order_number === "string" && record.order_number.trim()
        ? record.order_number.trim()
        : fallbackNumber,
    receipt_token: typeof record.receipt_token === "string" ? record.receipt_token : "",
    customer_name: typeof record.customer_name === "string" ? record.customer_name : "",
    phone_number: typeof record.phone_number === "string" ? record.phone_number : "",
    delivery_address: typeof record.delivery_address === "string" ? record.delivery_address : "",
    special_instructions:
      typeof record.special_instructions === "string" && record.special_instructions.trim()
        ? record.special_instructions.trim()
        : null,
    restaurant_id: toNumber(record.restaurant_id, 0),
    restaurant_name: typeof record.restaurant_name === "string" ? record.restaurant_name : "",
    restaurant_slug:
      typeof record.restaurant_slug === "string" && record.restaurant_slug.trim()
        ? record.restaurant_slug.trim()
        : null,
    subtotal: toNumber(record.subtotal, 0),
    standard_delivery_fee: standardFee,
    delivery_fee: deliveryFee,
    total: toNumber(record.total, 0),
    status: typeof record.status === "string" ? record.status : "New",
    payment_method: typeof record.payment_method === "string" ? record.payment_method : "eft_or_cash",
    payment_status: typeof record.payment_status === "string" ? record.payment_status : "pending",
    promo_code:
      typeof record.promo_code === "string" && record.promo_code.trim()
        ? record.promo_code.trim()
        : null,
    is_preorder: Boolean(record.is_preorder),
    created_at:
      typeof record.created_at === "string" && record.created_at
        ? record.created_at
        : new Date().toISOString(),
    items,
  };
}

async function extractInvokeErrorInfo(error: unknown): Promise<{
  status?: number;
  message: string;
  shouldFallbackToRpc: boolean;
}> {
  if (!error || typeof error !== "object") {
    return { message: "Could not submit order", shouldFallbackToRpc: true };
  }

  const errObj = error as {
    name?: string;
    message?: string;
    context?: Response | { status?: number; json?: () => Promise<unknown> };
  };

  if (errObj.name === "FunctionsFetchError" || errObj.name === "FunctionsRelayError") {
    return {
      message: errObj.message || "Edge function unreachable",
      shouldFallbackToRpc: true,
    };
  }

  const context = errObj.context;
  const status = context && typeof context.status === "number" ? context.status : undefined;

  if (status === 404 || status === 502 || status === 503 || status === 504) {
    return {
      status,
      message: errObj.message || "Order edge function unavailable",
      shouldFallbackToRpc: true,
    };
  }

  if (context && typeof context.json === "function") {
    try {
      const payload = (await context.json()) as { error?: string; message?: string };
      const serverMsg = payload?.error || payload?.message;
      if (typeof serverMsg === "string" && serverMsg.trim()) {
        const lower = serverMsg.toLowerCase();
        const isMissingFn = lower.includes("not found") && lower.includes("function");
        return {
          status,
          message: serverMsg,
          shouldFallbackToRpc: isMissingFn,
        };
      }
    } catch {
      // Response body already read or non-JSON; inspect message below.
    }
  }

  const msg = errObj.message || "Could not place your order";
  const shouldFallback =
    status === undefined &&
    (msg.toLowerCase().includes("failed to send a request") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("network"));

  return { status, message: msg, shouldFallbackToRpc: shouldFallback };
}

export async function placeDirectLockedOrder(
  input: PlaceDirectOrderInput,
): Promise<PlaceDirectOrderResult> {
  const cleanOrigin =
    input.origin ?? (typeof window !== "undefined" ? window.location.origin : undefined);

  const { data: fnData, error: fnError } = await supabase.functions.invoke("place-direct-order", {
    body: {
      customerName: input.customerName.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
      instructions: input.instructions?.trim() || null,
      origin: cleanOrigin,
      items: input.items,
    },
  });

  if (!fnError && fnData && typeof fnData === "object" && "receipt" in fnData) {
    const payload = fnData as {
      receipt: unknown;
      notifications?: OrderNotificationSummary;
    };
    return {
      receipt: normalizeOrderReceipt(payload.receipt),
      notifications: payload.notifications ?? { live_admin: "delivered" },
    };
  }

  if (fnError) {
    const info = await extractInvokeErrorInfo(fnError);
    if (!info.shouldFallbackToRpc) {
      throw new Error(info.message);
    }
  }

  // Fallback directly to the SECURITY DEFINER Postgres RPC when the Edge
  // Function has not yet been deployed. Pricing & immutability are still
  // enforced 100% server-side inside PostgreSQL.
  const { data: rpcData, error: rpcError } = await supabase.rpc("place_storefront_order", {
    p_customer_name: input.customerName.trim(),
    p_phone: input.phone.trim(),
    p_address: input.address.trim(),
    p_items: input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
    })),
    p_instructions: input.instructions?.trim() || null,
  });

  if (rpcError || !rpcData) {
    throw new Error(rpcError?.message || "Could not place your order. Please try again.");
  }

  return {
    receipt: normalizeOrderReceipt(rpcData),
    notifications: { live_admin: "delivered" },
  };
}

export async function fetchOrderReceipt(receiptToken: string): Promise<OrderReceipt | null> {
  const cleanToken = receiptToken.trim();
  if (!cleanToken) return null;

  const { data, error } = await supabase.rpc("get_order_receipt", {
    p_receipt_token: cleanToken,
  });

  if (error) {
    throw new Error(error.message || "Could not verify receipt.");
  }
  if (!data) return null;

  return normalizeOrderReceipt(data);
}

export function buildReceiptUrl(receiptToken: string, origin?: string): string {
  const base = (
    origin ?? (typeof window !== "undefined" ? window.location.origin : "https://roma.africa")
  ).replace(/\/$/, "");
  return `${base}/receipt/${encodeURIComponent(receiptToken)}`;
}

/**
 * Normalises South African local numbers (0XX...) and international numbers
 * (+27XX...) into bare digits suitable for https://wa.me/<digits>.
 */
export function formatWhatsAppDigits(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits.slice(1).replace(/[^\d]/g, "");
  }
  const bare = digits.replace(/[^\d]/g, "");
  if (bare.length === 10 && bare.startsWith("0")) {
    return `27${bare.slice(1)}`;
  }
  return bare;
}

export function buildAdminCustomerWhatsAppLink(options: {
  phone: string;
  customerName: string;
  orderNumber?: string | null;
  restaurantName: string;
  total: number;
  receiptToken?: string | null;
}): string {
  const digits = formatWhatsAppDigits(options.phone);
  if (!digits) return "";

  const orderLabel = options.orderNumber || "your order";
  const receiptUrl = options.receiptToken ? buildReceiptUrl(options.receiptToken) : null;

  const lines = [
    `Hi ${options.customerName}! Roma Eats here — we received your locked order ${orderLabel} from ${options.restaurantName} (Total: R ${Number(options.total).toFixed(2)}).`,
    ...(receiptUrl ? [`Official receipt: ${receiptUrl}`] : []),
  ];

  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
}
