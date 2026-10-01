# Roma – Local Food Delivery: Deployment Guide

You are **fully free of Lovable**. This repository is a standard Vite + React + TypeScript + Tailwind + Supabase app that you can host anywhere you like.

---

## What's in this project

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 18 + Vite 5 + TypeScript | SPA with `react-router-dom` client-side routing |
| UI | shadcn/ui + Tailwind CSS + Radix UI | Playfair Display + DM Sans fonts |
| State/forms | React Query, React Hook Form + Zod | Cart is in-memory (Context API) |
| Backend-as-a-Service | **Supabase** (project `jxfjbxrrbpfibdhwlhyh`) | Auth (email/password), Postgres DB, Edge Functions, Storage |
| Payments | **iKhokha** integration via Supabase Edge Functions | `create-ikhokha-payment`, `ikhokha-webhook` |
| Roles | `admin`, `deliverer`, `restaurant_owner`, customer | Enforced via Postgres RLS (`has_role` RPC) |

### Pages / routes
- `/` – Landing page (browse restaurants)
- `/restaurant/:id` – Restaurant menu
- `/checkout` – Cart + payment
- `/order-confirmation/:orderId` – Post-payment
- `/auth` – Sign in / Sign up
- `/my-orders` – Customer order history
- `/admin/login`, `/admin` – Super admin dashboard
- `/deliverer/login`, `/deliverer` – Deliverer dashboard
- `/owner/login`, `/owner` – Restaurant owner dashboard

### Supabase Edge Functions (deployed under `supabase/functions/`)
- `admin-create-user` – Create users with roles
- `create-ikhokha-payment` – Initiate iKhokha payment
- `ikhokha-webhook` – Receive payment confirmation from iKhokha
- `create-order` – Create an order transactionally

---

## Step 1 – Make sure you own the Supabase project

The app currently points to `https://jxfjbxrrbpfibdhwlhyh.supabase.co`. That project must be in **your** Supabase account, otherwise the previous owner can see/change all your data.

**Check:**
1. Log into https://supabase.com/dashboard
2. Do you see a project with reference id `jxfjbxrrbpfibdhwlhyh`?
   - If YES → great, it's yours.
   - If NO → you need to:
     1. Create a new Supabase project.
     2. Apply all migrations in `supabase/migrations/` in order of filename timestamp.
     3. Deploy the 4 Edge Functions (`supabase/functions/*`).
     4. Create the storage bucket `restaurant-images` (public read).
     5. Copy your new `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` into `.env`.
     6. Set any required Edge Function secrets (e.g. iKhokha API keys) using `supabase secrets set`.

To link/deploy to Supabase from your own machine:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push              # applies migrations
supabase functions deploy admin-create-user
supabase functions deploy create-order
supabase functions deploy create-ikhokha-payment
supabase functions deploy ikhokha-webhook
```

---

## Step 2 – Pick a host for the frontend

Because this is a static SPA (built into `/dist`), you can host it on **any** static host. Recommended options:

### Option A – Vercel (easiest, free tier)
1. Push this repo to your own GitHub.
2. Go to https://vercel.com/new → import the repo.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add environment variables (from `.env`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. In Vercel → Settings → Domains → add your domain (e.g. `roma.co.za`) and follow the DNS instructions.
7. A `vercel.json` is already present with SPA rewrites (all routes → `index.html`).

### Option B – Netlify
1. Push to GitHub → create new site from Git.
2. Build: `npm run build`, publish dir: `dist`.
3. Add env vars the same way.
4. Create a `public/_redirects` file with:
   ```
   /*  /index.html  200
   ```
5. Add your domain in Site settings → Domain management.

### Option C – Cloudflare Pages
1. Connect GitHub → build command `npm run build`, output dir `dist`.
2. Add env vars.
3. Add your custom domain. Cloudflare sets SSL automatically.
4. Create `_redirects` file same as Netlify.

### Option D – Your own VPS / cPanel
1. Run `npm run build` locally → upload the contents of `dist/` to your web root.
2. Make sure the web server rewrites all unknown paths to `/index.html` (otherwise refresh on `/checkout` will 404):
   - **Apache (.htaccess):**
     ```
     <IfModule mod_rewrite.c>
       RewriteEngine On
       RewriteBase /
       RewriteRule ^index\.html$ - [L]
       RewriteCond %{REQUEST_FILENAME} !-f
       RewriteCond %{REQUEST_FILENAME} !-d
       RewriteRule . /index.html [L]
     </IfModule>
     ```
   - **Nginx:**
     ```nginx
     location / {
       try_files $uri $uri/ /index.html;
     }
     ```
3. Enable HTTPS (Let's Encrypt / Certbot).

---

## Step 3 – Update Supabase Auth to allow your new domain

Go to **Supabase Dashboard → Authentication → URL Configuration**:
- **Site URL:** set to `https://yourdomain.com`
- **Redirect URLs:** add
  - `https://yourdomain.com/**`
  - Keep `http://localhost:8080/**` for local development

This is required for magic-link / OAuth / password-reset emails to send users to your domain instead of Lovable.

---

## Step 4 – Local development (so you can edit freely)

```bash
# 1. Install dependencies (npm or bun or pnpm)
npm install

# 2. Make sure .env has the right Supabase credentials
cp .env.example .env
# then edit .env

# 3. Run the dev server (http://localhost:8080)
npm run dev

# 4. Production build
npm run build
# output -> dist/
```

### To edit the site
- **Pages** → `src/pages/*.tsx`
- **Reusable components** → `src/components/` (shadcn/ui primitives are in `src/components/ui/`)
- **Site-wide styling / colors / fonts** → `src/index.css` + `tailwind.config.ts`
- **Routing** → `src/App.tsx`
- **Supabase calls / DB schema types** → `src/integrations/supabase/` (regenerate types with `supabase gen types typescript --project-ref YOUR_REF > src/integrations/supabase/types.ts`)
- **Static assets (images, favicon)** → `public/` and `src/assets/`
- **Hard-coded restaurant seed data** → `src/data/restaurants.ts` (real data lives in Supabase `restaurants` / `menu_items` tables)

---

## Step 5 – Environment variables recap

Required at runtime (built into the JS bundle, hence the `VITE_` prefix):

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase project → Settings → API → `anon` public key |

The iKhokha secret key should **NOT** be in Vite env vars — it must live as a Supabase Edge Function secret (set via `supabase secrets set IKHOKHA_SECRET_KEY=...`). The frontend never touches it.

---

## What I've already cleaned up for you

- Removed the `lovable-tagger` Vite plugin (which was only used for Lovable's in-browser visual editor).
- Removed the Lovable "brokered preview auth storage" that routed session tokens to Lovable's editor iframe; the app now uses plain `localStorage`, which is the standard for standalone deployments.
- Removed the signed Lovable/GCS og:image URLs (which expire) from `index.html`. Add a real `public/og-image.jpg` if you want social previews.
- Fixed `@import` ordering in `src/index.css` so production builds are clean.
- Vite dev/preview server now binds to `0.0.0.0:8080` with `allowedHosts: true` (runs anywhere).
- Added `.env.example` template.
- `.env` is now in `.gitignore` so your keys are not accidentally committed.
- The existing `vercel.json` SPA rewrite is kept so deploys "just work" on Vercel.

---

## One-click deploy references

- **Vercel:** Push to GitHub, then visit https://vercel.com/new
- **Netlify:** Drag-and-drop the `dist/` folder or connect Git: https://app.netlify.com
- **Cloudflare Pages:** https://dash.cloudflare.com → Pages → Create
