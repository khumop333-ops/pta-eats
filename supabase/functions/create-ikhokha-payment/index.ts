import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

const IKHOKHA_PAYLINK_PATH = '/public-api/v1/api/payment';
const IKHOKHA_BASE = 'https://api.ikhokha.com';

const BodySchema = z.object({
  orderId: z.string().uuid(),
  returnOrigin: z.string().url(),
});

function stringToSign(path: string, payload: string) {
  return (path + payload).replace(/\s/g, '');
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const appId = Deno.env.get('IKHOKHA_APP_ID');
    const appSecret = Deno.env.get('IKHOKHA_APP_SECRET');
    if (!appId || !appSecret) {
      return json({ error: 'iKhokha is not configured yet. Please add your iKhokha API credentials.' }, 500);
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

    const externalTransactionID = `roma-${order.id}`;
    const payload = {
      entityID: appId,
      externalEntityID: appId,
      amount: Math.round(Number(order.total) * 100),
      currency: 'ZAR',
      requesterUrl: returnOrigin,
      description: `Roma order from ${order.restaurant_name}`,
      paymentReference: order.id.slice(0, 8),
      mode: Deno.env.get('IKHOKHA_MODE') ?? 'live',
      externalTransactionID,
      urls: {
        callbackUrl: `${supabaseUrl}/functions/v1/ikhokha-webhook`,
        successPageUrl: `${returnOrigin}/order-confirmation/${order.id}?payment=success`,
        failurePageUrl: `${returnOrigin}/order-confirmation/${order.id}?payment=failed`,
        cancelUrl: `${returnOrigin}/order-confirmation/${order.id}?payment=cancelled`,
      },
    };

    const payloadStr = JSON.stringify(payload);
    const signature = await hmacHex(appSecret, stringToSign(IKHOKHA_PAYLINK_PATH, payloadStr));

    const response = await fetch(`${IKHOKHA_BASE}${IKHOKHA_PAYLINK_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'IK-APPID': appId,
        'IK-SIGN': signature,
      },
      body: payloadStr,
    });

    const text = await response.text();
    if (!response.ok) {
      console.error(`iKhokha paylink failed [${response.status}]: ${text}`);
      return json({ error: 'Payment provider request failed', status: response.status, details: text }, response.status);
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text);
    } catch {
      console.error('iKhokha returned non-JSON:', text);
      return json({ error: 'Unexpected response from payment provider', details: text }, 502);
    }

    const paylinkUrl = result.paylinkUrl as string | undefined;
    if (!paylinkUrl) {
      console.error('iKhokha response missing paylinkUrl:', text);
      return json({ error: 'Payment link not created', details: result }, 502);
    }

    await admin
      .from('orders')
      .update({
        payment_method: 'card',
        payment_status: 'pending',
        payment_reference: (result.paylinkId as string) ?? externalTransactionID,
      })
      .eq('id', order.id);

    return json({ paylinkUrl });
  } catch (err) {
    console.error('create-ikhokha-payment error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
