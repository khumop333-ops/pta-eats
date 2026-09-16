import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const WEBHOOK_PATH = '/functions/v1/ikhokha-webhook';

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

function equalHex(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function isSignatureValid(req: Request, rawBody: string, secret: string) {
  const provided = (
    req.headers.get('IK-SIGN') ??
    req.headers.get('ik-sign') ??
    req.headers.get('x-ik-sign') ??
    ''
  ).trim().toLowerCase();
  if (!provided) return false;

  const compact = rawBody.replace(/\s/g, '');
  const candidates = [
    (WEBHOOK_PATH + rawBody).replace(/\s/g, ''),
    compact,
    rawBody,
  ];
  for (const candidate of candidates) {
    if (equalHex(provided, await hmacHex(secret, candidate))) return true;
  }
  return false;
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

    const callbackAppId = req.headers.get('IK-APPID') ?? req.headers.get('ik-appid');
    if (callbackAppId !== appId) {
      return json({ error: 'Invalid app id' }, 401);
    }

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
    const orderId = externalId.startsWith('roma-') ? externalId.slice(5) : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
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
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, total, payment_method, payment_status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.error('Webhook: order not found');
      return json({ error: 'Unknown transaction' }, 400);
    }
    if (order.payment_method !== 'card') {
      return json({ error: 'Transaction is not a card order' }, 400);
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

    const { error } = await admin
      .from('orders')
      .update({
        payment_status: paid ? 'paid' : failed ? 'failed' : 'pending',
        paid_at: paid ? new Date().toISOString() : null,
      })
      .eq('id', orderId);

    if (error) {
      console.error('Webhook order update failed:', error.message);
      return json({ error: 'Update failed' }, 500);
    }

    return json({ received: true });
  } catch (err) {
    console.error('ikhokha-webhook error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});
