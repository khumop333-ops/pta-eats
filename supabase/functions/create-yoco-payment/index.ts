import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

// Yoco hosted checkout: https://developer.yoco.com/online/api-reference/checkout/payments/accept-payments/
// POST https://payments.yoco.com/api/checkouts  (Authorization: Bearer <YOCO_SECRET_KEY>)
// Returns { id, redirectUrl, ... }. The customer pays on Yoco's page and is
// redirected back; the authoritative confirmation arrives via yoco-webhook.
const YOCO_CHECKOUTS_URL = 'https://payments.yoco.com/api/checkouts';

const BodySchema = z.object({
  orderId: z.string().uuid(),
  returnOrigin: z.string().url(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const secretKey = Deno.env.get('YOCO_SECRET_KEY');
    if (!secretKey) {
      return json({ error: 'Yoco is not configured yet. Please add the YOCO_SECRET_KEY secret.' }, 500);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { orderId, returnOrigin } = parsed.data;

    // Authenticate the caller
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, total, user_id, restaurant_name, payment_status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) return json({ error: 'Order not found' }, 404);
    if (order.user_id !== userData.user.id) return json({ error: 'Forbidden' }, 403);
    if (order.payment_status === 'paid') return json({ error: 'Order already paid' }, 400);

    const payload = {
      amountInCents: Math.round(Number(order.total) * 100),
      currency: 'ZAR',
      successUrl: `${returnOrigin}/order-confirmation/${order.id}?payment=success`,
      failureUrl: `${returnOrigin}/order-confirmation/${order.id}?payment=failed`,
      cancelUrl: `${returnOrigin}/order-confirmation/${order.id}?payment=cancelled`,
      metadata: {
        orderId: order.id,
        restaurantName: order.restaurant_name,
      },
    };

    const response = await fetch(YOCO_CHECKOUTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secretKey}`,
        // Safe to retry creating a checkout for the same order.
        'Idempotency-Key': `roma-order-${order.id}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error(`Yoco checkout failed [${response.status}]: ${text}`);
      return json({ error: 'Payment provider request failed', status: response.status }, 502);
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text);
    } catch {
      console.error('Yoco returned non-JSON:', text);
      return json({ error: 'Unexpected response from payment provider' }, 502);
    }

    const redirectUrl = result.redirectUrl as string | undefined;
    const checkoutId = result.id as string | undefined;
    if (!redirectUrl || !checkoutId) {
      console.error('Yoco response missing id/redirectUrl:', text);
      return json({ error: 'Payment link not created' }, 502);
    }

    await admin
      .from('orders')
      .update({
        payment_method: 'card',
        payment_status: 'pending',
        payment_reference: checkoutId,
      })
      .eq('id', order.id);

    return json({ redirectUrl, checkoutId });
  } catch (err) {
    console.error('create-yoco-payment error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
