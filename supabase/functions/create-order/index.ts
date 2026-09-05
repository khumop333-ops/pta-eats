import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

const DELIVERY_FEE = 15;

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

    const priceById = new Map(menuItems.map((m) => [m.id, m]));
    const orderItems = body.items.map((i) => {
      const m = priceById.get(i.menuItemId)!;
      return {
        item_name: m.name,
        item_price: Number(m.price),
        quantity: i.quantity,
      };
    });

    const subtotal = orderItems.reduce((sum, i) => sum + i.item_price * i.quantity, 0);
    const roundedSubtotal = Math.round(subtotal * 100) / 100;
    const total = Math.round((roundedSubtotal + DELIVERY_FEE) * 100) / 100;

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        customer_name: body.customerName,
        phone_number: body.phone,
        delivery_address: body.address,
        special_instructions: body.instructions || null,
        restaurant_id: restaurant.id,
        restaurant_name: restaurant.name,
        subtotal: roundedSubtotal,
        delivery_fee: DELIVERY_FEE,
        total,
        status: 'New',
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
      await admin.from('orders').delete().eq('id', order.id);
      return json({ error: 'Could not place your order' }, 500);
    }

    return json({ orderId: order.id, subtotal: roundedSubtotal, deliveryFee: DELIVERY_FEE, total });
  } catch (err) {
    console.error('create-order error:', err);
    return json({ error: 'Could not place your order' }, 500);
  }
});
