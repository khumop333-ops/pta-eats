import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Yoco posts payment events here. Deliveries are signed Svix-style:
//   headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<base64>")
//   signed content: `${webhook-id}.${webhook-timestamp}.${rawBody}`
//   key: base64-decode(YOCO_WEBHOOK_SECRET without the "whsec_" prefix)
//   signature: base64( HMAC-SHA256(key, signed content) )
// Events are only trusted after the signature verifies.
// Docs: https://developer.yoco.com/online/api-reference/webhooks/verifying-events/

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function expectedSignature(secret: string, id: string, timestamp: string, rawBody: string) {
  const keyBytes = base64ToBytes(secret.replace(/^whsec_/, ''));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  return bytesToBase64(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isSignatureValid(req: Request, rawBody: string, secret: string) {
  const id = req.headers.get('webhook-id') ?? '';
  const timestamp = req.headers.get('webhook-timestamp') ?? '';
  const signatureHeader = req.headers.get('webhook-signature') ?? '';
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const expected = await expectedSignature(secret, id, timestamp, rawBody);
  // Header may carry several space-separated "v1,<sig>" entries during key rotation.
  return signatureHeader
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      const sig = part.startsWith('v1,') ? part.slice(3) : part;
      return timingSafeEqual(sig, expected);
    });
}

/** Dig a value out of the event wherever Yoco nests it (payload / data / root). */
function dig(event: Record<string, unknown>, keys: string[]): unknown {
  const levels: Record<string, unknown>[] = [event];
  for (const nest of ['payload', 'data', 'object']) {
    const v = event[nest];
    if (v && typeof v === 'object') levels.push(v as Record<string, unknown>);
  }
  for (const level of levels) {
    for (const key of keys) {
      if (level[key] !== undefined && level[key] !== null) return level[key];
    }
    const metadata = level.metadata;
    if (metadata && typeof metadata === 'object') {
      for (const key of keys) {
        const v = (metadata as Record<string, unknown>)[key];
        if (v !== undefined && v !== null) return v;
      }
    }
  }
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const secret = Deno.env.get('YOCO_WEBHOOK_SECRET');
    if (!secret) {
      console.error('Webhook rejected: YOCO_WEBHOOK_SECRET is not configured');
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

    const type = String(dig(event, ['type', 'eventType', 'event']) ?? '').toLowerCase();
    const statusText = String(dig(event, ['status']) ?? '').toLowerCase();
    const paid =
      type.includes('payment.completed') || type.includes('payment.succeeded') ||
      type.includes('payment.successful') || type.endsWith('.paid') ||
      ['completed', 'succeeded', 'successful', 'paid'].includes(statusText);
    const failed =
      type.includes('failed') || type.includes('cancelled') || type.includes('canceled') ||
      type.includes('expired') || ['failed', 'cancelled', 'canceled', 'expired'].includes(statusText);
    if (!paid && !failed) return json({ received: true, ignored: type || 'unknown' });

    // Resolve our order: metadata.orderId first, then the Yoco checkout id we stored.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const metadataOrderId = dig(event, ['orderId', 'order_id']);
    const checkoutId = dig(event, ['checkoutId', 'checkout_id', 'id']);
    let order: { id: string; total: number } | null = null;

    if (typeof metadataOrderId === 'string' && /^[0-9a-f-]{36}$/i.test(metadataOrderId)) {
      const { data } = await admin.from('orders').select('id, total').eq('id', metadataOrderId).maybeSingle();
      order = data;
    }
    if (!order && typeof checkoutId === 'string' && checkoutId) {
      const { data } = await admin
        .from('orders')
        .select('id, total')
        .eq('payment_reference', checkoutId)
        .maybeSingle();
      order = data;
    }
    if (!order) {
      console.error('Webhook: could not resolve order for event', type);
      return json({ error: 'Unknown transaction' }, 400);
    }

    // If the event reports an amount, it must match the authoritative order total.
    const reportedCents = Number(dig(event, ['amountInCents', 'amount']) ?? NaN);
    if (paid && Number.isFinite(reportedCents)) {
      const expectedCents = Math.round(Number(order.total) * 100);
      // Yoco reports cents; tolerate a plain-rand amount only if it matches exactly in cents terms.
      const matches = Math.round(reportedCents) === expectedCents;
      if (!matches) {
        console.error('Webhook rejected: amount mismatch for order', order.id);
        return json({ error: 'Amount mismatch' }, 400);
      }
    }

    const paymentId = dig(event, ['paymentId', 'payment_id']);
    const { error } = await admin
      .from('orders')
      .update({
        payment_status: paid ? 'paid' : 'failed',
        paid_at: paid ? new Date().toISOString() : null,
        ...(paid && typeof paymentId === 'string' ? { payment_reference: paymentId } : {}),
      })
      .eq('id', order.id);

    if (error) {
      console.error('Webhook order update failed:', error.message);
      return json({ error: 'Update failed' }, 500);
    }

    return json({ received: true });
  } catch (err) {
    console.error('yoco-webhook error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});
