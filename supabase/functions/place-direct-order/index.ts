import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

const DEFAULT_ROMA_WHATSAPP_TO = '27612821819';

const BodySchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(30),
  address: z.string().trim().min(5).max(300),
  instructions: z.string().trim().max(500).optional().nullable(),
  origin: z.string().trim().url().max(300).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(50),
});

interface LockedReceiptItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  line_total: number;
}

interface LockedOrderReceipt {
  order_id: string;
  order_number: string;
  receipt_token: string;
  customer_name: string;
  phone_number: string;
  delivery_address: string;
  special_instructions: string | null;
  restaurant_id: number;
  restaurant_name: string;
  restaurant_slug: string | null;
  subtotal: number;
  standard_delivery_fee: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  promo_code: string | null;
  is_preorder: boolean;
  created_at: string;
  items: LockedReceiptItem[];
}

type ChannelDeliveryState = 'sent' | 'not_configured' | 'failed';

function formatMoney(amount: number): string {
  return `R ${Number(amount).toFixed(2)}`;
}

function formatSastTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function buildAlertPlainText(receipt: LockedOrderReceipt, siteOrigin?: string): string {
  const header = receipt.is_preorder
    ? `⏰ NEW LOCKED PRE-ORDER — ${receipt.order_number}`
    : `🛎️ NEW LOCKED ORDER — ${receipt.order_number}`;

  const itemLines = (receipt.items ?? []).map(
    (item) => `• ${item.quantity}x ${item.name} — ${formatMoney(item.line_total)}`,
  );

  const deliveryLine =
    Number(receipt.delivery_fee) === 0
      ? `FREE${receipt.promo_code ? ` (Verified ${receipt.promo_code}, saved ${formatMoney(receipt.standard_delivery_fee)})` : ''}`
      : formatMoney(receipt.delivery_fee);

  const receiptUrl = siteOrigin ? `${siteOrigin.replace(/\/$/, '')}/receipt/${receipt.receipt_token}` : null;
  const adminUrl = siteOrigin ? `${siteOrigin.replace(/\/$/, '')}/admin` : null;

  return [
    header,
    `Placed: ${formatSastTimestamp(receipt.created_at)} SAST`,
    ...(receipt.is_preorder ? ['Window: Scheduled for next 08:00 SAST opening'] : []),
    '',
    `Restaurant: ${receipt.restaurant_name}`,
    ...itemLines,
    '',
    `Subtotal: ${formatMoney(receipt.subtotal)}`,
    `Delivery: ${deliveryLine}`,
    `LOCKED TOTAL: ${formatMoney(receipt.total)}`,
    'Payment: EFT or Cash on delivery',
    '',
    `Customer: ${receipt.customer_name}`,
    `Phone: ${receipt.phone_number}`,
    `Address: ${receipt.delivery_address}`,
    ...(receipt.special_instructions ? [`Notes: ${receipt.special_instructions}`] : []),
    ...(receiptUrl ? ['', `Verified Receipt: ${receiptUrl}`] : []),
    ...(adminUrl ? [`Admin Dashboard: ${adminUrl}`] : []),
  ].join('\n');
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildAlertHtml(receipt: LockedOrderReceipt, siteOrigin?: string): string {
  const receiptUrl = siteOrigin ? `${siteOrigin.replace(/\/$/, '')}/receipt/${receipt.receipt_token}` : null;
  const adminUrl = siteOrigin ? `${siteOrigin.replace(/\/$/, '')}/admin` : null;
  const rows = (receipt.items ?? [])
    .map(
      (i) =>
        `<tr>
          <td style="padding:6px 0;border-bottom:1px solid #eee;">${i.quantity}x ${escapeHtml(i.name)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${formatMoney(i.line_total)}</td>
        </tr>`,
    )
    .join('');

  const deliveryLabel =
    Number(receipt.delivery_fee) === 0
      ? `FREE${receipt.promo_code ? ` (${escapeHtml(receipt.promo_code)})` : ''}`
      : formatMoney(receipt.delivery_fee);

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#16a34a;font-weight:700;">
        Server-Verified Locked Order
      </div>
      <h2 style="margin:6px 0 4px;">${escapeHtml(receipt.order_number)} · ${escapeHtml(receipt.restaurant_name)}</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">
        ${escapeHtml(formatSastTimestamp(receipt.created_at))} SAST${receipt.is_preorder ? ' · <strong>PRE-ORDER (Next 08:00 SAST)</strong>' : ''}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">
        ${rows}
      </table>
      <div style="font-size:14px;line-height:1.6;">
        <div>Subtotal: <strong>${formatMoney(receipt.subtotal)}</strong></div>
        <div>Delivery: <strong>${deliveryLabel}</strong></div>
        <div style="font-size:18px;margin-top:4px;">Locked Total: <strong>${formatMoney(receipt.total)}</strong></div>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
      <div style="font-size:14px;line-height:1.6;">
        <div><strong>Customer:</strong> ${escapeHtml(receipt.customer_name)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(receipt.phone_number)}</div>
        <div><strong>Address:</strong> ${escapeHtml(receipt.delivery_address)}</div>
        ${receipt.special_instructions ? `<div><strong>Notes:</strong> ${escapeHtml(receipt.special_instructions)}</div>` : ''}
      </div>
      ${
        receiptUrl || adminUrl
          ? `<div style="margin-top:18px;display:flex;gap:12px;">
              ${receiptUrl ? `<a href="${escapeHtml(receiptUrl)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;">View Official Receipt</a>` : ''}
              ${adminUrl ? `<a href="${escapeHtml(adminUrl)}" style="background:#f3f4f6;color:#111827;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;">Open Admin Dashboard</a>` : ''}
            </div>`
          : ''
      }
    </div>
  `;
}

async function dispatchWhatsAppCloudAlert(
  receipt: LockedOrderReceipt,
  plainText: string,
): Promise<ChannelDeliveryState> {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')?.trim();
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')?.trim();
  const recipient = (Deno.env.get('ROMA_ALERT_WHATSAPP_TO')?.trim() || DEFAULT_ROMA_WHATSAPP_TO).replace(
    /[^\d]/g,
    '',
  );

  if (!accessToken || !phoneNumberId || !recipient) {
    return 'not_configured';
  }

  const endpoint = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const textResp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { preview_url: true, body: plainText },
    }),
  });

  if (textResp.ok) {
    return 'sent';
  }

  const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME')?.trim();
  if (templateName) {
    const templateResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: Deno.env.get('WHATSAPP_TEMPLATE_LANG')?.trim() || 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: receipt.order_number },
                { type: 'text', text: receipt.restaurant_name },
                { type: 'text', text: formatMoney(receipt.total) },
                { type: 'text', text: `${receipt.customer_name} (${receipt.phone_number})` },
                { type: 'text', text: receipt.delivery_address },
              ],
            },
          ],
        },
      }),
    });

    if (templateResp.ok) {
      return 'sent';
    }
  }

  console.error('place-direct-order: WhatsApp Cloud API failed with status', textResp.status);
  return 'failed';
}

async function dispatchResendEmailAlert(
  receipt: LockedOrderReceipt,
  plainText: string,
  siteOrigin?: string,
): Promise<ChannelDeliveryState> {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const toEmail = Deno.env.get('ROMA_ALERT_EMAIL')?.trim();
  const fromEmail = Deno.env.get('ROMA_ALERT_FROM_EMAIL')?.trim() || 'Roma Eats Orders <onboarding@resend.dev>';

  if (!apiKey || !toEmail) {
    return 'not_configured';
  }

  const subjectPrefix = receipt.is_preorder ? '[PRE-ORDER]' : '[NEW ORDER]';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: toEmail.split(',').map((addr) => addr.trim()).filter(Boolean),
      subject: `${subjectPrefix} ${receipt.order_number} · ${receipt.restaurant_name} (${formatMoney(receipt.total)})`,
      text: plainText,
      html: buildAlertHtml(receipt, siteOrigin),
    }),
  });

  if (!resp.ok) {
    console.error('place-direct-order: Resend email alert failed with status', resp.status);
    return 'failed';
  }
  return 'sent';
}

async function dispatchTelegramAlert(plainText: string): Promise<ChannelDeliveryState> {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim();
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')?.trim();

  if (!botToken || !chatId) {
    return 'not_configured';
  }

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: plainText,
      disable_web_page_preview: true,
    }),
  });

  if (!resp.ok) {
    console.error('place-direct-order: Telegram alert failed with status', resp.status);
    return 'failed';
  }
  return 'sent';
}

async function dispatchWebhookAlert(
  receipt: LockedOrderReceipt,
  plainText: string,
): Promise<ChannelDeliveryState> {
  const webhookUrl = Deno.env.get('ROMA_ORDER_WEBHOOK_URL')?.trim();
  if (!webhookUrl) {
    return 'not_configured';
  }

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'order.locked',
      receipt,
      formatted_text: plainText,
    }),
  });

  if (!resp.ok) {
    console.error('place-direct-order: Webhook alert failed with status', resp.status);
    return 'failed';
  }
  return 'sent';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return json({ error: 'Invalid JSON request body' }, 400);
    }

    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: 'Invalid order details', details: parsed.error.flatten().fieldErrors }, 400);
    }
    const body = parsed.data;

    const authHeader = req.headers.get('Authorization');
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
    });

    const rpcItems = body.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
    }));

    const { data: receiptData, error: rpcError } = await callerClient.rpc('place_storefront_order', {
      p_customer_name: body.customerName,
      p_phone: body.phone,
      p_address: body.address,
      p_items: rpcItems,
      p_instructions: body.instructions ?? null,
    });

    if (rpcError || !receiptData) {
      console.error('place-direct-order: place_storefront_order failed:', rpcError?.message);
      return json({ error: rpcError?.message || 'Could not place your order' }, 400);
    }

    const receipt = receiptData as LockedOrderReceipt;
    const siteOrigin = body.origin || req.headers.get('origin') || undefined;
    const plainText = buildAlertPlainText(receipt, siteOrigin);

    const [waResult, emailResult, telegramResult, webhookResult] = await Promise.allSettled([
      dispatchWhatsAppCloudAlert(receipt, plainText),
      dispatchResendEmailAlert(receipt, plainText, siteOrigin),
      dispatchTelegramAlert(plainText),
      dispatchWebhookAlert(receipt, plainText),
    ]);

    const notifications = {
      live_admin: 'delivered' as const,
      whatsapp_cloud: waResult.status === 'fulfilled' ? waResult.value : ('failed' as ChannelDeliveryState),
      email: emailResult.status === 'fulfilled' ? emailResult.value : ('failed' as ChannelDeliveryState),
      telegram: telegramResult.status === 'fulfilled' ? telegramResult.value : ('failed' as ChannelDeliveryState),
      webhook: webhookResult.status === 'fulfilled' ? webhookResult.value : ('failed' as ChannelDeliveryState),
      dispatched_at: new Date().toISOString(),
    };

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error: statusErr } = await admin
      .from('orders')
      .update({ notification_status: notifications })
      .eq('id', receipt.order_id);

    if (statusErr) {
      console.warn('place-direct-order: could not persist notification_status:', statusErr.message);
    }

    return json({ receipt, notifications });
  } catch (err) {
    console.error('place-direct-order: unhandled exception:', err);
    return json({ error: 'Internal error' }, 500);
  }
});
