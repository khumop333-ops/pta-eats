import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// iKhokha posts payment status callbacks here. No JWT — verified by transaction lookup.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const raw = await req.text();
    console.log('iKhokha webhook payload:', raw);

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
      console.error('Webhook: could not resolve order id from', externalId);
      return json({ error: 'Unknown transaction' }, 400);
    }

    const status = String(event.status ?? event.transactionStatus ?? '').toUpperCase();
    const paid = ['SUCCESS', 'COMPLETE', 'COMPLETED', 'PAID', 'SETTLED'].includes(status);
    const failed = ['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(status);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await admin
      .from('orders')
      .update({
        payment_status: paid ? 'paid' : failed ? 'failed' : 'pending',
        paid_at: paid ? new Date().toISOString() : null,
      })
      .eq('id', orderId);

    if (error) {
      console.error('Webhook order update failed:', error.message);
      return json({ error: error.message }, 500);
    }

    return json({ received: true });
  } catch (err) {
    console.error('ikhokha-webhook error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
