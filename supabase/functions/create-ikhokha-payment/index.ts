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

function configuredOrigins() {
  const configured = Deno.env.get('APP_ALLOWED_ORIGINS') ?? Deno.env.get('SITE_URL') ?? '';
  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
}

function normalizeAllowedOrigin(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return null;
    }
    const origin = parsed.origin;
    return configuredOrigins().includes(origin) ? origin : null;
  } catch {
    return null;
  }
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!appId || !appSecret || !supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'iKhokha is not configured yet.' }, 500);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { orderId, returnOrigin } = parsed.data;
    const allowedOrigin = normalizeAllowedOrigin(returnOrigin);
    if (!allowedOrigin) {
      return json({ error: 'Payment return origin is not allowed' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, total, user_id, restaurant_name, payment_method, payment_status, status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) return json({ error: 'Order not found' }, 404);
    if (order.user_id !== userData.user.id) return json({ error: 'Forbidden' }, 403);
    if (order.payment_method !== 'card') return json({ error: 'This order is not a card order' }, 400);
    if (order.payment_status === 'paid') return json({ error: 'Order already paid' }, 400);
    if (order.status === 'Delivered' || order.status === 'Cancelled') {
      return json({ error: 'This order can no longer be paid' }, 400);
    }

    const externalTransactionID = `roma-${order.id}`;
    const payload = {
      entityID: appId,
      externalEntityID: appId,
      amount: Math.round(Number(order.total) * 100),
      currency: 'ZAR',
      requesterUrl: allowedOrigin,
      description: `Roma order from ${order.restaurant_name}`,
      paymentReference: order.id.slice(0, 8),
      mode: Deno.env.get('IKHOKHA_MODE') ?? 'live',
      externalTransactionID,
      urls: {
        callbackUrl: `${supabaseUrl}/functions/v1/ikhokha-webhook`,
        successPageUrl: `${allowedOrigin}/order-confirmation/${order.id}?payment=success`,
        failurePageUrl: `${allowedOrigin}/order-confirmation/${order.id}?payment=failed`,
        cancelUrl: `${allowedOrigin}/order-confirmation/${order.id}?payment=cancelled`,
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
      await admin.from('orders').update({ payment_status: 'failed', paid_at: null }).eq('id', order.id);
      return json({ error: 'Payment provider request failed' }, 502);
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text);
    } catch {
      console.error('iKhokha returned non-JSON:', text);
      await admin.from('orders').update({ payment_status: 'failed', paid_at: null }).eq('id', order.id);
      return json({ error: 'Unexpected response from payment provider' }, 502);
    }

    const paylinkUrl = typeof result.paylinkUrl === 'string' ? result.paylinkUrl : undefined;
    if (!paylinkUrl || !paylinkUrl.startsWith('https://')) {
      console.error('iKhokha response missing a secure paylinkUrl:', text);
      await admin.from('orders').update({ payment_status: 'failed', paid_at: null }).eq('id', order.id);
      return json({ error: 'Payment link not created' }, 502);
    }

    const paymentReference =
      (typeof result.paylinkID === 'string' && result.paylinkID) ||
      (typeof result.paylinkId === 'string' && result.paylinkId) ||
      externalTransactionID;

    const { error: updateError } = await admin
      .from('orders')
      .update({
        payment_method: 'card',
        payment_status: 'pending',
        payment_reference: paymentReference,
        paid_at: null,
      })
      .eq('id', order.id);

    if (updateError) {
      console.error('Could not record payment attempt:', updateError.message);
      return json({ error: 'Could not record payment attempt' }, 500);
    }

    return json({ paylinkUrl });
  } catch (err) {
    console.error('create-ikhokha-payment error:', err);
    return json({ error: 'Could not start card payment' }, 500);
  }
});
