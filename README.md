# Roma

Roma is a Pretoria Central food-delivery app built with React, Vite, Tailwind, and Supabase.

## Local development

```sh
npm ci
cp .env.example .env
npm run dev
```

Set these browser-safe variables in `.env`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

The publishable Supabase key is safe to expose in the browser. Never put a Supabase service-role key or iKhokha secret in `.env`, frontend code, or Git.

## Supabase setup

Apply the migrations in `supabase/migrations` in filename order. The latest migrations:

- Create atomic, idempotent order creation for the Edge Function
- Restrict deliverers to assigned orders
- Centralize status, assignment, payment, and cash-switch mutations in role-aware functions
- Add consistent order statuses and data constraints
- Add a database-backed rate limiter for order, payment, admin-account, and webhook functions

Deploy the Edge Functions and configure these Supabase secrets:

```sh
supabase secrets set \
  IKHOKHA_APP_ID=... \
  IKHOKHA_APP_SECRET=... \
  IKHOKHA_MODE=live \
  APP_ALLOWED_ORIGINS=https://your-production-domain.example
```

For local development, `APP_ALLOWED_ORIGINS` can contain a comma-separated list such as `http://localhost:8080,http://localhost:5173`. The payment function rejects return URLs that are not in this allowlist.

## Quality checks

```sh
npm run build
npm run lint
npm test
npx tsc -p tsconfig.app.json --noEmit
npm audit
```

## Deployment

The Vercel rewrite in `vercel.json` supports client-side routes. Connect this repository to Vercel with the Vite framework preset, then configure these project environment variables for Production, Preview, and Development as appropriate:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PROJECT_ID
VITE_SUPABASE_PUBLISHABLE_KEY
```

Deploy the Supabase migration and Edge Functions before enabling checkout. Configure the server-side secrets above, then confirm the iKhokha webhook points to:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/ikhokha-webhook
```

For payment verification, use an iKhokha test/sandbox merchant first and verify all of these cases:

1. Card success updates the order to `paid`.
2. Card failure and cancellation leave the order retryable.
3. A customer can switch an unpaid card order to cash.
4. A replayed or late failure callback cannot undo a paid order.
5. A callback with a bad signature, app ID, order ID, or amount is rejected.
6. A return URL from an origin not in `APP_ALLOWED_ORIGINS` is rejected.

The production bundle lazy-loads route code and the Supabase SDK. Keep an eye on the Vite build report when adding dependencies so the shared chunk does not grow again.
