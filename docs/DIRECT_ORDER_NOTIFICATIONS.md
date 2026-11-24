# Direct Locked Orders & Automatic Dispatch Setup

Every order submitted on `/order` is priced and locked on the server via `public.place_storefront_order(...)` (guests and signed-in customers alike). Customers never touch an editable WhatsApp text draft.

## What Works Out of the Box (Zero Extra Secrets)

1. **Authoritative Database Pricing & Locking (`public.place_storefront_order`)**:
   - Re-prices every item directly from `public.menu_items`.
   - Applies the restaurant's database delivery fee (`R15` for Magwinya Zone, `R20` for other restaurants).
   - Auto-applies 1 free-delivery credit (`FD-XXXXXX`) for signed-in users with available credits and unlocks any pending friend referral reward.
   - Assigns an immutable `order_number` (`ROMA-1001+`) and unguessable `receipt_token` (`/receipt/:receiptToken`).
   - Protected against post-creation price/total tampering by the `orders_protect_money` trigger.
2. **Live Admin Dashboard (`/admin`)**:
   - Receives every new order in real time via Supabase Realtime with audio/toast alerts, `PRE-ORDER` badges, `FD-XXXXXX` promo verification badges, verified receipt links, and 1-tap customer WhatsApp outreach.
3. **Official Locked Receipt PNG**:
   - Customers receive a downloadable/shareable high-DPI PNG receipt image and permanent `/receipt/:receiptToken` verification link.

## Enabling Instant Server-to-Phone Alerts (`place-direct-order` Edge Function)

Deploy the edge function to your Supabase project:

```bash
supabase functions deploy place-direct-order --no-verify-jwt
```

Configure any combination of the channels below via `supabase secrets set` (all configured channels fire in parallel on every order):

### 1. Meta WhatsApp Business Cloud API (Direct Server -> Roma WhatsApp)

```bash
supabase secrets set \
  WHATSAPP_ACCESS_TOKEN="<meta-permanent-system-user-token>" \
  WHATSAPP_PHONE_NUMBER_ID="<meta-whatsapp-phone-number-id>" \
  ROMA_ALERT_WHATSAPP_TO="27612821819"
```

Optional template fallback (for notifications outside an active 24-hour customer service window):

```bash
supabase secrets set \
  WHATSAPP_TEMPLATE_NAME="new_locked_order" \
  WHATSAPP_TEMPLATE_LANG="en"
```

### 2. Instant Email Alerts (Resend)

```bash
supabase secrets set \
  RESEND_API_KEY="re_xxxxxxxxx" \
  ROMA_ALERT_EMAIL="orders@yourdomain.co.za" \
  ROMA_ALERT_FROM_EMAIL="Roma Eats Orders <orders@yourdomain.co.za>"
```

### 3. Instant Telegram Push Alerts

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="123456789:AA..." \
  TELEGRAM_CHAT_ID="-1001234567890"
```

### 4. Optional Custom Webhook (Make / Zapier / n8n / Slack)

```bash
supabase secrets set ROMA_ORDER_WEBHOOK_URL="https://hooks.example.com/..."
```
