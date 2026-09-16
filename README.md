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

Apply the migrations in `supabase/migrations` in filename order. The latest order-workflow migration:

- Creates atomic, idempotent order creation for the Edge Function
- Restricts deliverers to assigned orders
- Centralizes status, assignment, payment, and cash-switch mutations in role-aware functions
- Adds consistent order statuses and data constraints

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

The Vercel rewrite in `vercel.json` supports client-side routes. Configure the three `VITE_*` variables in the deployment provider and configure the Supabase secrets above. Confirm the iKhokha webhook points to:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/ikhokha-webhook
```
