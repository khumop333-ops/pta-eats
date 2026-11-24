# Roma — Local Food Delivery, Pretoria Central

Customer storefront for roma.africa. Browse Pretoria Central kitchens, build a cart,
and place a server-priced order (bank transfer / EFT or cash on delivery).

Standard **Vite + React 18 + TypeScript + Tailwind + Supabase** app. No proprietary
builder, editor, or preview service is involved — host it anywhere.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript (SPA, `react-router-dom`) |
| UI | shadcn/ui + Tailwind CSS + Radix primitives |
| Backend | Supabase (Postgres, Auth, RLS, Edge Functions, Realtime) |
| Payments | Yoco hosted checkout (card) — optional; default flow is EFT/cash |

## Local development

```bash
npm install
cp .env.example .env     # then fill in VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev              # http://localhost:8080
```

`.env` is git-ignored. It holds **public** values only (`VITE_*` is baked into the
browser bundle). Never put a `service_role` key or a payment secret there — those
belong in Supabase Edge Function secrets (`supabase secrets set`).

## Scripts

```bash
npm run dev       # dev server
npm run build     # production build -> dist/
npm run preview   # serve the production build
npm test          # vitest (unit)
npm run lint      # eslint
```

## Key paths

- Routes → `src/App.tsx`
- Ordering flow → `src/pages/PublicRestaurantPage.tsx` → `src/pages/WhatsAppCheckout.tsx`
- Cart state → `src/context/CartContext.tsx`
- Server-side pricing → `supabase/functions/place-direct-order/index.ts` + the
  `place_storefront_order` SQL function in `supabase/migrations/`
- Payments → `supabase/functions/create-yoco-payment/`, `supabase/functions/yoco-webhook/`
- Schema & RLS → `supabase/migrations/`

## Security model (read before changing order code)

- **Prices are never trusted from the client.** `place_storefront_order` re-prices
  every line from `menu_items`, enforces one restaurant per order, and recomputes
  the delivery fee and total inside Postgres.
- **`orders` has no direct INSERT policy.** Orders are created only through the
  `SECURITY DEFINER` RPC. Money and ownership columns are locked by the
  `orders_protect_money` trigger.
- **Receipts** are fetched by an unguessable `receipt_token` via `get_order_receipt`.

## Deploy

Vercel (`vercel.json` SPA rewrite), Netlify (`netlify.toml`), Cloudflare Pages
(`public/_redirects`), or Apache/Nginx (`htaccess.example`, `nginx.example.conf`).
See `DEPLOYMENT_GUIDE.md`.
