import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

const BodySchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(30),
  address: z.string().trim().min(5).max(300),
  instructions: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.enum(['card', 'cash']),
  idempotencyKey: z.string().uuid(),
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error('create-order: Supabase function secrets are missing');
      return json({ error: 'Order service is not configured' }, 500);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'Unauthorized' }, 401);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await admin.rpc('create_order_atomic', {
      _customer_name: body.customerName,
      _phone_number: body.phone,
      _delivery_address: body.address,
      _special_instructions: body.instructions || null,
      _payment_method: body.paymentMethod,
      _user_id: userData.user.id,
      _idempotency_key: body.idempotencyKey,
      _items: body.items.map((item) => ({
        menu_item_id: item.menuItemId,
        quantity: item.quantity,
      })),
    });

    if (error || !data?.[0]) {
      console.error('create-order: atomic insert failed:', error?.message);
      const clientError = error?.code === '22023' || error?.code === 'P0002';
      return json(
        { error: clientError ? error.message : 'Could not place your order' },
        clientError ? 400 : 500,
      );
    }

    const order = data[0];
    return json({
      orderId: order.order_id,
      subtotal: order.subtotal,
      deliveryFee: order.delivery_fee,
      total: order.total,
    });
  } catch (err) {
    console.error('create-order error:', err);
    return json({ error: 'Could not place your order' }, 500);
  }
});
