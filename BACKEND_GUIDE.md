# Backend - Fresh Start Guide

You said: "It seems like there is no backend, it's built but it's not appearing I'm thinking of starting it fresh"

You were right - the original project had **no backend folder**. It was only:
- Frontend: Vite + React
- BaaS: Supabase (remote, not visible locally)

So I built a fresh backend from scratch. It's now at `server/` and **running**.

## What's New

```
pta-eats/
├── src/              # frontend (existing)
├── server/           # NEW - fresh Express backend
│   ├── src/
│   │   ├── index.ts  # entry - starts server on :3001
│   │   ├── app.ts    # express app + CORS + static serving
│   │   ├── config.ts
│   │   ├── db/
│   │   │   ├── store.ts  # JSON file persistence
│   │   │   └── seed.ts   # seed script
│   │   ├── routes/
│   │   │   ├── restaurants.ts
│   │   │   ├── menu.ts
│   │   │   ├── orders.ts      # mirrors create-order edge function
│   │   │   ├── auth.ts        # signup/login/me
│   │   │   ├── admin.ts       # mirrors admin-create-user
│   │   │   └── payments.ts    # mirrors iKhokha
│   │   ├── middleware/auth.ts
│   │   └── types/
│   ├── data/db.json  # auto-created, gitignored
│   ├── package.json
│   └── README.md
├── .env              # now includes VITE_USE_BACKEND
└── vite.config.ts    # now proxies /api -> backend
```

## How to Run (You have 3 options)

### Option 1: Both frontend + backend together (recommended for dev)
```bash
npm run backend:install   # first time only
npm run backend:seed      # first time only - creates test accounts
npm run dev:all
```
- Frontend: http://localhost:8080 (Vite)
- Backend:  http://localhost:3001 (Express)
- You will see a green "Backend Online" badge in bottom-right of frontend.

### Option 2: Backend only
```bash
cd server
npm install
npm run seed
npm run dev
```
Then test:
```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/restaurants
```

### Option 3: Production single server
```bash
npm run build              # builds frontend to dist/
npm run backend:build      # builds backend to server/dist/
cd server && npm start     # serves both frontend + API on :3001
```

## Backend is Visible Now

Previously:
- `npm run build` only built frontend to `dist/`
- No server logs, no API you could curl
- Supabase logic hidden in remote dashboard

Now:
- `server/src/index.ts` logs clearly:
  ```
  🚀 PTA Eats Backend running!
     Local:   http://localhost:3001
     Health:  http://localhost:3001/health
     API:     http://localhost:3001/api/restaurants
  ```
- You can `curl`, Postman, or browser the API
- Data is in `server/data/db.json` - you can open it, edit it, delete it to reset
- Logs show every request if you add morgan (currently console.log on errors)

## Test Accounts (after seed)

All passwords are simple for dev - change in production!

- Admin: admin@roma.co.za / admin123
- Deliverer: deliverer@roma.co.za / deliverer123
- Owner: owner@roma.co.za / owner123 (owns Mama's Kitchen)
- Customer: customer@test.com / customer123

Login example:
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@roma.co.za","password":"admin123"}'
```

Returns JWT token. Use it:
```bash
TOKEN=eyJhb...
curl http://localhost:3001/api/auth/me -H "Authorization: Bearer $TOKEN"
```

## Frontend Integration

The frontend now has a toggle:

- `.env` has `VITE_USE_BACKEND=false` by default (keeps using Supabase, so nothing breaks)
- If you set `VITE_USE_BACKEND=true`, then `src/data/restaurants.ts` will call the fresh backend first.

Also:
- `vite.config.ts` proxies `/api` to backend, so even in Supabase mode you can call backend via `/api/...` from frontend code.
- `src/lib/backend.ts` is a new client wrapper for backend.
- `src/components/BackendStatus.tsx` shows a badge if backend is online.

## What Mirrors Supabase?

| Supabase | New Backend |
|----------|-------------|
| `restaurants` table | `GET /api/restaurants` |
| `menu_items` table | `GET /api/menu-items` |
| `orders` + `order_items` | `POST /api/orders` (server calculates totals) |
| `create-order` edge function | `POST /api/orders` |
| `create-ikhokha-payment` | `POST /api/payments/create-ikhokha-payment` |
| `ikhokha-webhook` | `POST /api/payments/ikhokha-webhook` |
| `admin-create-user` | `POST /api/admin/users` |
| `auth` | `POST /api/auth/signup`, `POST /api/auth/login` |
| RLS `has_role` | `requireRole('admin')` middleware |

## If You Want to Go Full Backend (No Supabase)

1. Set `VITE_USE_BACKEND=true` in `.env`
2. Update all pages that use `supabase.from(...)` to use `apiFetch` from `@/lib/backend`
   - I've already updated `src/data/restaurants.ts` as example
   - Remaining pages to update: `Checkout.tsx`, `AdminDashboard.tsx`, `OwnerDashboard.tsx`, `DelivererDashboard.tsx`, `MyOrders.tsx`
   - I can do that for you if you want - just say "migrate frontend to backend"
3. Then you can delete `src/integrations/supabase` if you want pure backend.

## If You Want to Keep Supabase

You can keep both:
- Backend runs for local dev without needing Supabase account
- Supabase still works as before
- Frontend badge shows which is active

This is useful if Supabase project `jxfjbxrrbpfibdhwlhyh` is not in your account.

## Deployment

- **Frontend alone**: Vercel/Netlify as before (dist folder)
- **Backend alone**: Deploy `server/` to Render, Railway, Fly.io, etc. Set `PORT` env var.
- **Both together**: Build frontend, then backend serves it. Deploy server to any Node host.

Example Dockerfile (I can create if you want):
```dockerfile
FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
WORKDIR /app/server
RUN npm install
RUN npm run build
EXPOSE 3001
CMD ["npm","start"]
```

## Next Steps

Let me know if you want me to:
1. Migrate all frontend pages to use new backend (so Supabase optional)
2. Add WebSocket real-time orders
3. Add image upload endpoint
4. Create Dockerfile
5. Add tests for backend

Backend is now **visible and running** at http://localhost:3001 - you can see it in logs!
