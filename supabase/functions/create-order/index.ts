import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

const BodySchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(30),
  address: z.string().trim().min(5).max(300),
  instructions: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.enum(['card', 'cash']),
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

    // Authoritative prices come from the database, never from the client.
    const ids = [...new Set(body.items.map((i) => i.menuItemId))];
    const { data: menuItems, error: menuErr } = await admin
      .from('menu_items')
      .select('id, name, price, restaurant_id')
      .in('id', ids);

    if (menuErr) {
      console.error('create-order: menu lookup failed:', menuErr.message);
      return json({ error: 'Could not price your order' }, 500);
    }
    if (!menuItems || menuItems.length !== ids.length) {
      return json({ error: 'Some items are no longer available' }, 400);
    }

    const restaurantIds = [...new Set(menuItems.map((m) => m.restaurant_id))];
    if (restaurantIds.length !== 1) {
      return json({ error: 'All items must come from the same restaurant' }, 400);
    }
    const restaurantId = restaurantIds[0];

    const { data: restaurant, error: restErr } = await admin
      .from('restaurants')
      .select('id, name')
      .eq('id', restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return json({ error: 'Restaurant not found' }, 400);

    // Collapse duplicate menu item ids into a single line per item so the quantity
    // sent to the database is the quantity actually charged for.
    const quantityById = new Map<string, number>();
    for (const i of body.items) {
      quantityById.set(i.menuItemId, (quantityById.get(i.menuItemId) ?? 0) + i.quantity);
    }

    const priceById = new Map(menuItems.map((m) => [m.id, m]));
    const orderItems = [...quantityById.entries()].map(([id, quantity]) => {
      const m = priceById.get(id)!;
      return {
        item_name: m.name,
        item_price: Number(m.price),
        quantity,
      };
    });

    const subtotal = orderItems.reduce((sum, i) => sum + i.item_price * i.quantity, 0);
    const roundedSubtotal = Math.round(subtotal * 100) / 100;

    // The order and its items are written by one SECURITY DEFINER function, so a
    // failure can no longer leave an order row behind with no items. The delivery
    // fee and total are computed inside that function from app_settings.
    const { data: result, error: orderErr } = await admin.rpc('create_order_with_items', {
      p_customer_name: body.customerName,
      p_phone_number: body.phone,
      p_delivery_address: body.address,
      p_special_instructions: body.instructions || null,
      p_restaurant_id: restaurant.id,
      p_restaurant_name: restaurant.name,
      p_subtotal: roundedSubtotal,
      p_payment_method: body.paymentMethod,
      p_user_id: userData.user.id,
      p_items: orderItems,
    });

    if (orderErr || !result) {
      console.error('create-order: insert failed:', orderErr?.message);
      return json({ error: 'Could not place your order' }, 500);
    }

    const created = result as {
      orderId: string;
      subtotal: number;
      deliveryFee: number;
      total: number;
    };

    return json({
      orderId: created.orderId,
      subtotal: created.subtotal,
      deliveryFee: created.deliveryFee,
      total: created.total,
    });
  } catch (err) {
    console.error('create-order error:', err);
    return json({ error: 'Could not place your order' }, 500);
  }
});
