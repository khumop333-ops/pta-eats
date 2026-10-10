import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// The path iKhokha signs, prefixed to the request body to produce the expected
// HMAC. This must match the callbackUrl registered in create-ikhokha-payment.
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

// Length-independent comparison so the check does not leak the signature length.
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// iKhokha posts payment status callbacks here. Requests must carry a valid HMAC
// signature produced with our iKhokha app secret, otherwise they are rejected.
//
// This function is deployed with verify_jwt = false (see supabase/config.toml),
// because iKhokha cannot present a Supabase JWT. This signature check is therefore
// the only thing standing between the internet and the orders table, so it accepts
// exactly one canonical signing string rather than several candidates.
async function isSignatureValid(req: Request, rawBody: string, secret: string) {
  const provided = (
    req.headers.get('IK-SIGN') ??
    req.headers.get('ik-sign') ??
    req.headers.get('x-ik-sign') ??
    ''
  ).trim().toLowerCase();
  if (!provided) return false;

  const expected = await hmacHex(secret, (WEBHOOK_PATH + rawBody).replace(/\s/g, ''));
  return timingSafeEqual(provided, expected);
}

const PAID_STATUSES = ['SUCCESS', 'COMPLETE', 'COMPLETED', 'PAID', 'SETTLED'];
const FAILED_STATUSES = ['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const secret = Deno.env.get('IKHOKHA_APP_SECRET');
    if (!secret) {
      console.error('Webhook rejected: IKHOKHA_APP_SECRET is not configured');
      return json({ error: 'Not configured' }, 503);
    }

    const raw = await req.text();

    if (!(await isSignatureValid(req, raw, secret))) {
      console.error('Webhook rejected: invalid or missing signature');
      return json({ error: 'Invalid signature' }, 401);
    }

    let event: Record<string, unknown> = {};
    try {
      event = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const externalId =
      (event.externalTransactionID as string) ??
      (event.externalTransactionId as string) ??
      (event.externalEntityID as string) ??
      '';
    const orderId = externalId.startsWith('roma-') ? externalId.slice(5) : '';
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      console.error('Webhook: could not resolve order id');
      return json({ error: 'Unknown transaction' }, 400);
    }

    const status = String(event.status ?? event.transactionStatus ?? '').toUpperCase();
    const paid = PAID_STATUSES.includes(status);
    const failed = FAILED_STATUSES.includes(status);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, total, payment_status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.error('Webhook: order not found');
      return json({ error: 'Unknown transaction' }, 400);
    }

    // If the callback reports an amount, it must match the authoritative order total.
    const reportedCents = Number(event.amount ?? NaN);
    if (paid && Number.isFinite(reportedCents)) {
      const expectedCents = Math.round(Number(order.total) * 100);
      if (Math.round(reportedCents) !== expectedCents) {
        console.error('Webhook rejected: amount mismatch for order', orderId);
        return json({ error: 'Amount mismatch' }, 400);
      }
    }

    // Idempotency: providers retry callbacks, and retries can arrive out of order.
    // Once an order is paid it is never moved back to pending or failed by a
    // webhook, and paid_at is never cleared. Acknowledge the duplicate as received
    // so the provider stops retrying.
    if (order.payment_status === 'paid') {
      return json({ received: true, alreadyPaid: true });
    }

    // An event that is neither a success nor a known failure carries no state we
    // can act on. Record that we accepted it without touching the order, instead
    // of resetting payment_status to pending.
    if (!paid && !failed) {
      console.log(`Webhook: ignoring unrecognised status "${status}" for order ${orderId}`);
      return json({ received: true, ignored: true });
    }

    const { error } = await admin
      .from('orders')
      .update({
        payment_status: paid ? 'paid' : 'failed',
        paid_at: paid ? new Date().toISOString() : null,
      })
      .eq('id', orderId)
      // Guard against a concurrent webhook that paid this order between the read
      // above and this write.
      .neq('payment_status', 'paid');

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
