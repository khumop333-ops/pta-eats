import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  equalHex,
  hmacHex,
  IKHOKHA_WEBHOOK_PATH,
  payloadToSign,
} from '../_shared/ikhokha.ts';

const ORDER_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

async function isSignatureValid(req: Request, rawBody: string, secret: string) {
  const provided = (
    req.headers.get('IK-SIGN') ??
    req.headers.get('ik-sign') ??
    req.headers.get('x-ik-sign') ??
    ''
  ).trim().toLowerCase();
  if (!provided) return false;

  const expected = await hmacHex(secret, payloadToSign(IKHOKHA_WEBHOOK_PATH, rawBody));
  return equalHex(provided, expected);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const secret = Deno.env.get('IKHOKHA_APP_SECRET');
    const appId = Deno.env.get('IKHOKHA_APP_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret || !appId || !supabaseUrl || !serviceRoleKey) {
      console.error('Webhook rejected: payment secrets are not configured');
      return json({ error: 'Not configured' }, 503);
    }

    const callbackAppId = (req.headers.get('IK-APPID') ?? req.headers.get('ik-appid') ?? '').trim();
    if (callbackAppId !== appId.trim()) {
      return json({ error: 'Invalid app id' }, 401);
    }

    // Read the raw body before parsing it. The exact bytes are part of the
    // iKhokha signature and must not be reconstructed with JSON.stringify.
    const raw = await req.text();
    if (!(await isSignatureValid(req, raw, secret))) {
      console.error('Webhook rejected: invalid or missing signature');
      return json({ error: 'Invalid signature' }, 401);
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const externalId =
      (typeof event.externalTransactionID === 'string' && event.externalTransactionID) ||
      (typeof event.externalTransactionId === 'string' && event.externalTransactionId) ||
      '';
    const orderMatch = externalId.match(new RegExp(`^roma-(${ORDER_ID_PATTERN})(?:-.+)?$`, 'i'));
    const orderId = orderMatch?.[1] ?? '';
    if (!orderId) {
      console.error('Webhook: could not resolve order id');
      return json({ error: 'Unknown transaction' }, 400);
    }

    const status = String(event.status ?? event.transactionStatus ?? '').toUpperCase();
    const paid = ['SUCCESS', 'COMPLETE', 'COMPLETED', 'PAID', 'SETTLED'].includes(status);
    const failed = ['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(status);
    if (!paid && !failed && status !== 'PENDING') {
      return json({ error: 'Unsupported payment status' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: allowed, error: rateLimitError } = await admin.rpc('consume_rate_limit', {
      _bucket_key: `ikhokha-webhook:${externalId}`,
      _max_requests: 30,
      _window_seconds: 60,
    });
    if (rateLimitError) {
      console.error('Webhook: rate limiter failed:', rateLimitError.message);
      return json({ error: 'Temporarily unavailable' }, 503);
    }
    if (allowed !== true) {
      return json({ error: 'Too many callbacks' }, 429);
    }

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, total, payment_method, payment_status, payment_reference')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.error('Webhook: order not found');
      return json({ error: 'Unknown transaction' }, 400);
    }
    if (order.payment_method !== 'card') {
      return json({ error: 'Transaction is not a card order' }, 400);
    }

    // New attempts store their external transaction ID as payment_reference.
    // Ignore callbacks from an older retry, while still accepting callbacks for
    // legacy orders that stored the provider paylink ID instead.
    if (
      typeof order.payment_reference === 'string' &&
      order.payment_reference.startsWith('roma-') &&
      order.payment_reference !== externalId
    ) {
      return json({ received: true });
    }

    // iKhokha callbacks commonly contain status and externalTransactionID but
    // may omit amount. When supplied, the amount must always match our order.
    const reportedAmount = event.amount ?? event.transactionAmount;
    if (paid && reportedAmount !== undefined) {
      const reportedCents = Number(reportedAmount);
      const expectedCents = Math.round(Number(order.total) * 100);
      if (!Number.isFinite(reportedCents) || Math.round(reportedCents) !== expectedCents) {
        console.error('Webhook rejected: amount mismatch for order', orderId);
        return json({ error: 'Amount mismatch' }, 400);
      }
    }

    // Never let a late failed/pending callback undo a confirmed payment.
    if (order.payment_status === 'paid') {
      return json({ received: true });
    }

    const { data: updated, error } = await admin
      .from('orders')
      .update({
        payment_status: paid ? 'paid' : failed ? 'failed' : 'pending',
        paid_at: paid ? new Date().toISOString() : null,
      })
      .eq('id', orderId)
      .eq('payment_method', 'card')
      .neq('payment_status', 'paid')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Webhook order update failed:', error.message);
      return json({ error: 'Update failed' }, 500);
    }

    // A concurrent success may have won the update. It is safe to acknowledge
    // the callback because the order is already in the desired terminal state.
    if (!updated) return json({ received: true });

    return json({ received: true });
  } catch (err) {
    console.error('ikhokha-webhook error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});
