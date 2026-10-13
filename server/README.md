# PTA Eats - Fresh Backend (Express)

This is a **brand new backend** built from scratch for PTA Eats / Roma food delivery app. It was created because the original project was frontend-only (Vite + Supabase) and had no visible backend server.

## What it does

- Provides a full REST API for restaurants, menu items, orders, auth, admin, and payments
- File-based JSON persistence (`data/db.json`) - no external DB needed for dev
- JWT auth + bcrypt password hashing
- Role-based access: `admin`, `deliverer`, `restaurant_owner`, `user`
- Mirrors the Supabase Edge Functions: `create-order`, `create-ikhokha-payment`, `ikhokha-webhook`, `admin-create-user`
- Can also serve the frontend `dist/` in production (single-server deploy)

## Quick Start

```bash
cd server
npm install
npm run seed   # creates admin/deliverer/owner/customer accounts + 4 restaurants
npm run dev    # starts on http://localhost:3001
```

Check health:
```bash
curl http://localhost:3001/health
```

## Default Accounts (after seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@roma.co.za | admin123 |
| Deliverer | deliverer@roma.co.za | deliverer123 |
| Owner | owner@roma.co.za | owner123 |
| Customer | customer@test.com | customer123 |

## API Endpoints

### Health
- `GET /health` - health check
- `GET /api/health`

### Restaurants
- `GET /api/restaurants` - list all
- `GET /api/restaurants/:id` - single with menu
- `GET /api/restaurants/:id/menu` - menu only
- `POST /api/restaurants` - admin only
- `PUT /api/restaurants/:id` - admin or owner of that restaurant
- `DELETE /api/restaurants/:id` - admin only

### Menu Items
- `GET /api/menu-items?restaurant_id=1`
- `GET /api/menu-items/:id`
- `POST /api/menu-items` - admin/owner
- `PUT /api/menu-items/:id` - admin/owner
- `DELETE /api/menu-items/:id` - admin/owner

### Orders (mirrors create-order edge function)
- `POST /api/orders` - create order (auth required, calculates totals server-side from live menu prices)
- `GET /api/orders` - list orders (filtered by role: user sees own, owner sees own restaurant orders, admin/deliverer see all)
- `GET /api/orders/:id`
- `PATCH /api/orders/:id/status` - update status (admin/deliverer/owner)
- `POST /api/orders/:id/mark-paid` - admin only

### Auth
- `POST /api/auth/signup` - { email, password, full_name?, phone_number? }
- `POST /api/auth/login` - { email, password } -> { user, token }
- `GET /api/auth/me` - auth required
- `GET /api/auth/users` - admin only

### Admin (mirrors admin-create-user)
- `POST /api/admin/users` - create deliverer or restaurant_owner (admin only)
  ```json
  { "email": "new@owner.com", "password": "secret123", "role": "restaurant_owner", "restaurant_id": 1, "full_name": "New Owner" }
  ```
- `GET /api/admin/stats` - admin only

### Payments (mirrors iKhokha)
- `POST /api/payments/create-ikhokha-payment` - { orderId, returnOrigin } -> { paylinkUrl }
  - Currently returns mock paylink that redirects to success page
  - If you set IKHOKHA_APP_ID + IKHOKHA_APP_SECRET env vars, it will log that it would call real API
- `POST /api/payments/ikhokha-webhook` - webhook endpoint (public)
- `POST /api/payments/mock-confirm/:orderId` - dev helper to mark order paid

## Data Storage

- File: `server/data/db.json`
- Created automatically on first run if missing
- Delete it and run `npm run seed` to reset

Structure:
```json
{
  "users": [],
  "restaurants": [],
  "menu_items": [],
  "orders": [],
  "order_items": []
}
```

## Environment Variables

See `.env.example`:

```
PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:8080
DATA_FILE=./data/db.json
IKHOKHA_APP_ID=
IKHOKHA_APP_SECRET=
IKHOKHA_MODE=test
```

## Frontend Integration

The frontend can use this backend in two ways:

1. **Proxy mode (default dev)**: Vite proxies `/api` and `/health` to `http://localhost:3001`. So frontend can call `/api/restaurants` directly.

2. **Full backend mode**: Set in root `.env`:
   ```
   VITE_USE_BACKEND=true
   VITE_API_URL=/api
   ```
   Then `src/data/restaurants.ts` will try backend first, fallback to Supabase.

3. **Production single server**: Build frontend (`npm run build` in root) then run backend (`npm start` in server). Backend will detect `../dist` and serve it. So `http://localhost:3001` serves both API and frontend.

## Running Both Frontend + Backend

From project root:

```bash
# Install all
npm install
npm run backend:install

# Seed backend
npm run backend:seed

# Run both concurrently
npm run dev:all
# Frontend: http://localhost:8080
# Backend:  http://localhost:3001
```

Or separately:
```bash
# Terminal 1 - backend
cd server && npm run dev

# Terminal 2 - frontend
npm run dev
```

## Production Build

```bash
# Build frontend
npm run build

# Build backend
npm run backend:build

# Start backend (serves frontend dist + API)
cd server && npm start
# or
npm run backend:start
```

## Why This Exists

Original repo had:
- No backend folder
- Only Supabase as BaaS
- Frontend build output but no server to host API logic visibly

This new backend:
- Is visible, runnable, debuggable locally
- Doesn't require Supabase account to develop
- Mirrors all Supabase logic so you can switch between them
- Provides clear logs and seed data
- Ready to deploy anywhere (VPS, Render, Railway, Fly.io, etc.)

## Next Steps / TODO

- Add SQLite/Postgres option via env var
- Add WebSockets for real-time order updates (currently polling in frontend)
- Add image upload endpoint (currently uses static assets)
- Add proper iKhokha SDK integration when you have live credentials
- Add tests
