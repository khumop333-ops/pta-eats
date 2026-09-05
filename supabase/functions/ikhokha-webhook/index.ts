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

// iKhokha posts payment status callbacks here. Requests must carry a valid
// HMAC signature produced with our iKhokha app secret, otherwise they are rejected.
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
    if (provided === (await hmacHex(secret, candidate))) return true;
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
    const paid = ['SUCCESS', 'COMPLETE', 'COMPLETED', 'PAID', 'SETTLED'].includes(status);
    const failed = ['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(status);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, total')
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
