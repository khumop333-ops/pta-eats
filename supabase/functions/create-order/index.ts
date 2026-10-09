import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

/**
 * create-order — place an order.
 *
 * PRICING: this function does NOT calculate money. It calls `quote_order()`,
 * which is the single pricing authority also used by the web client to render the
 * cart total. Previously this file held its own `const DELIVERY_FEE = 15` —
 * one of four copies of that number. The displayed total and the charged total are
 * now computed from one implementation and cannot diverge.
 *
 * STATUS: written as 'pending', the canonical lowercase vocabulary enforced by
 * orders_status_check. This function previously wrote `status: 'New'`, which the
 * CHECK constraint rejects — so this line is load-bearing for order placement
 * actually working. `supabase/tests/dispatch.test.mjs` includes a contract test
 * that fails if any edge function reintroduces a legacy status literal.
 */

const BodySchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(30),
  address: z.string().trim().min(5).max(300),
  instructions: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.enum(['card', 'cash']),
  // Optional; the database defaults to the central zone and rejects unknown codes.
  zone: z.string().trim().max(40).optional().nullable(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(50),
});

/** Shape of the jsonb returned by public.quote_order(). */
interface OrderQuote {
  ok: boolean;
  error?: string;
  zone?: string;
  zoneLabel?: string;
  restaurantId?: number;
  subtotalCents?: number;
  deliveryFeeCents?: number;
  totalCents?: number;
  canPlaceOrder?: boolean;
  service?: {
    isOpen: boolean;
    canOrder: boolean;
    reason: string;
    nextOpenAt: string | null;
    openTime?: string;
    closeTime?: string;
  };
}

/** Failure code -> HTTP status and customer-safe message. */
const QUOTE_ERRORS: Record<string, { status: number; message: string }> = {
  empty_basket: { status: 400, message: 'Your basket is empty.' },
  basket_too_large: { status: 400, message: 'That is too many items for one order.' },
  unknown_zone: { status: 400, message: 'We do not deliver to that area yet.' },
  invalid_item: { status: 400, message: 'Something in your basket is not right.' },
  item_unavailable: { status: 409, message: 'An item in your basket is no longer available.' },
  mixed_restaurants: { status: 400, message: 'An order can only come from one restaurant.' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'Unauthorized' }, 401);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ---- Price the basket via the single authority -------------------------
    const { data: quoteData, error: quoteErr } = await admin.rpc('quote_order', {
      p_items: body.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      p_zone: body.zone ?? null,
    });

    if (quoteErr) {
      console.error('create-order: quote_order failed:', quoteErr.message);
      return json({ error: 'Could not price your order' }, 500);
    }

    const quote = quoteData as OrderQuote | null;
    if (!quote || !quote.ok) {
      const code = quote?.error ?? 'unknown';
      const mapped = QUOTE_ERRORS[code] ?? {
        status: 400,
        message: 'Could not price your order',
      };
      // The zone is echoed so the client can highlight the offending selection.
      return json({ error: mapped.message, code, zone: quote?.zone }, mapped.status);
    }

    // ---- Service window ----------------------------------------------------
    // Enforced here, not only in the UI. A client that hides the Pay button is a
    // courtesy; this is the control. Note this is a DELIBERATE, CONFIGURABLE
    // policy: service_config.accept_orders_outside_window can permit taking
    // tomorrow's orders overnight. Dispatch is separate and always windowed — a
    // rider can never claim outside trading hours regardless of this flag.
    if (!quote.canPlaceOrder) {
      return json(
        {
          error: 'We are closed right now.',
          code: 'service_closed',
          service: quote.service,
        },
        409,
      );
    }

    if (
      quote.restaurantId == null ||
      quote.subtotalCents == null ||
      quote.deliveryFeeCents == null ||
      quote.totalCents == null
    ) {
      console.error('create-order: malformed quote', JSON.stringify(quote));
      return json({ error: 'Could not price your order' }, 500);
    }

    // ---- Resolve restaurant name and line items ----------------------------
    const { data: restaurant, error: restErr } = await admin
      .from('restaurants')
      .select('id, name')
      .eq('id', quote.restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return json({ error: 'Restaurant not found' }, 400);

    const menuIds = body.items.map((i) => i.menuItemId);
    const { data: menuItems, error: menuErr } = await admin
      .from('menu_items')
      .select('id, name, price')
      .in('id', menuIds);
    if (menuErr || !menuItems) {
      console.error('create-order: menu lookup failed:', menuErr?.message);
      return json({ error: 'Could not place your order' }, 500);
    }
    const priceById = new Map(menuItems.map((m) => [m.id, m]));

    const orderItems = body.items.map((i) => {
      const m = priceById.get(i.menuItemId);
      if (!m) throw new Error(`menu item ${i.menuItemId} vanished between quote and insert`);
      return {
        item_name: m.name,
        item_price: Number(m.price),
        quantity: i.quantity,
      };
    });

    // ---- Persist -----------------------------------------------------------
    // `delivery_fee` (numeric rands) is derived from `delivery_fee_cents` by a
    // BEFORE trigger, so it is deliberately not written here. Supplying both
    // would reintroduce exactly the two-sources-of-truth problem this change
    // removes.
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        customer_name: body.customerName,
        phone_number: body.phone,
        delivery_address: body.address,
        special_instructions: body.instructions || null,
        restaurant_id: restaurant.id,
        restaurant_name: restaurant.name,
        subtotal: quote.subtotalCents / 100,
        delivery_fee_cents: quote.deliveryFeeCents,
        delivery_zone: quote.zone ?? 'central',
        total: quote.totalCents / 100,
        // Canonical lowercase vocabulary. 'New' here would violate
        // orders_status_check and break order placement entirely.
        status: 'pending',
        user_id: userData.user.id,
        payment_method: body.paymentMethod,
        payment_status: 'pending',
      })
      .select('id, total')
      .single();

    if (orderErr || !order) {
      console.error('create-order: insert failed:', orderErr?.message);
      return json({ error: 'Could not place your order' }, 500);
    }

    const { error: itemsErr } = await admin
      .from('order_items')
      .insert(orderItems.map((i) => ({ ...i, order_id: order.id })));

    if (itemsErr) {
      console.error('create-order: items insert failed:', itemsErr.message);
      // Roll back the orphaned order rather than leaving a basket with no lines.
      await admin.from('orders').delete().eq('id', order.id);
      return json({ error: 'Could not place your order' }, 500);
    }

    return json({
      orderId: order.id,
      subtotalCents: quote.subtotalCents,
      deliveryFeeCents: quote.deliveryFeeCents,
      totalCents: quote.totalCents,
      zone: quote.zone,
      total: quote.totalCents / 100,
    });
  } catch (err) {
    console.error('create-order error:', err);
    return json({ error: 'Could not place your order' }, 500);
  }
});
