import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import {
  hmacHex,
  IKHOKHA_API_BASE,
  IKHOKHA_PAYMENT_PATH,
  payloadToSign,
} from '../_shared/ikhokha.ts';

const BodySchema = z.object({
  orderId: z.string().uuid(),
  returnOrigin: z.string().url(),
});

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

function isSecurePaylink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
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
    const { data: allowed, error: rateLimitError } = await admin.rpc('consume_rate_limit', {
      _bucket_key: `create-payment:${userData.user.id}`,
      _max_requests: 12,
      _window_seconds: 60,
    });
    if (rateLimitError) {
      console.error('create-ikhokha-payment: rate limiter failed:', rateLimitError.message);
      return json({ error: 'Payment service is temporarily unavailable' }, 503);
    }
    if (allowed !== true) {
      return json({ error: 'Too many payment attempts. Please wait a minute and try again.' }, 429);
    }

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

    // Each attempt gets a unique provider transaction ID. This allows a
    // customer to retry after a decline without reusing an old paylink ID.
    const externalTransactionID = `roma-${order.id}-${crypto.randomUUID()}`;
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

    const payloadString = JSON.stringify(payload);
    const signature = await hmacHex(appSecret, payloadToSign(IKHOKHA_PAYMENT_PATH, payloadString));

    const response = await fetch(`${IKHOKHA_API_BASE}${IKHOKHA_PAYMENT_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'IK-APPID': appId,
        'IK-SIGN': signature,
      },
      body: payloadString,
    });

    const text = await response.text();
    const markPaymentFailed = async () => {
      const { error } = await admin
        .from('orders')
        .update({ payment_status: 'failed', paid_at: null })
        .eq('id', order.id)
        .neq('payment_status', 'paid');
      if (error) console.error('Could not mark payment attempt failed:', error.message);
    };

    if (!response.ok) {
      console.error(`iKhokha paylink failed [${response.status}]: ${text}`);
      await markPaymentFailed();
      return json({ error: 'Payment provider request failed' }, 502);
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text);
    } catch {
      console.error('iKhokha returned non-JSON:', text);
      await markPaymentFailed();
      return json({ error: 'Unexpected response from payment provider' }, 502);
    }

    if (String(result.responseCode ?? '') !== '00') {
      console.error('iKhokha rejected paylink:', text);
      await markPaymentFailed();
      return json({ error: 'Payment link was not created' }, 502);
    }

    const paylinkUrl = typeof result.paylinkUrl === 'string' ? result.paylinkUrl : undefined;
    if (!paylinkUrl || !isSecurePaylink(paylinkUrl)) {
      console.error('iKhokha response missing a secure paylinkUrl:', text);
      await markPaymentFailed();
      return json({ error: 'Payment link not created' }, 502);
    }

    // Keep the external transaction ID as the current attempt reference. It is
    // also present in the webhook, which lets us ignore a late callback from an
    // older retry without allowing it to change the new attempt's status.
    const paymentReference = externalTransactionID;

    // A callback can arrive before this response is persisted. Never overwrite
    // a payment that was already confirmed while the provider call was running.
    const { data: recorded, error: updateError } = await admin
      .from('orders')
      .update({
        payment_method: 'card',
        payment_status: 'pending',
        payment_reference: paymentReference,
        paid_at: null,
      })
      .eq('id', order.id)
      .eq('payment_method', 'card')
      .neq('payment_status', 'paid')
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('Could not record payment attempt:', updateError.message);
      return json({ error: 'Could not record payment attempt' }, 500);
    }

    if (!recorded) {
      const { data: current } = await admin
        .from('orders')
        .select('payment_status')
        .eq('id', order.id)
        .maybeSingle();
      if (current?.payment_status === 'paid') return json({ paylinkUrl });
      return json({ error: 'Order payment method changed' }, 409);
    }

    return json({ paylinkUrl });
  } catch (err) {
    console.error('create-ikhokha-payment error:', err);
    return json({ error: 'Could not start card payment' }, 500);
  }
});
