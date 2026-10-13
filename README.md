# PTA Eats / Roma - Food Delivery

Pretoria Central food delivery app. Now with **fresh backend**!

## Architecture

- **Frontend**: Vite + React 18 + TypeScript + Tailwind + shadcn/ui (port 8080)
- **Backend**: Express + JWT + bcrypt + JSON file DB (port 3001) - **NEW**
- **Original BaaS**: Supabase (still works, but backend is now visible alternative)

## Quick Start - Fresh Backend (Recommended)

You said backend wasn't appearing - now it does!

```bash
# 1. Install both
npm install
npm run backend:install

# 2. Seed backend with test data
npm run backend:seed
# Creates:
# - admin@roma.co.za / admin123
# - deliverer@roma.co.za / deliverer123
# - owner@roma.co.za / owner123
# - customer@test.com / customer123
# + 4 restaurants, 19 menu items

# 3. Run both
npm run dev:all
```

- Frontend: http://localhost:8080
- Backend: http://localhost:3001/health
- API: http://localhost:3001/api/restaurants

You'll see a "Backend Online" badge in the UI.

## API Quick Test

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/restaurants | jq
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@roma.co.za","password":"admin123"}' | jq
```

## Documentation

- `server/README.md` - full backend API docs
- `BACKEND_GUIDE.md` - why backend was created + migration guide
- `DEPLOYMENT_GUIDE.md` - original deployment guide (Supabase + Vercel)
- `supabase/` - original Supabase migrations & edge functions (still valid)

## Frontend Modes

### Supabase mode (default, original behavior)
```env
# .env
VITE_USE_BACKEND=false
```
Uses Supabase directly. Backend still runs but frontend doesn't call it.

### Backend mode (new)
```env
VITE_USE_BACKEND=true
VITE_API_URL=/api
```
Frontend tries backend first, falls back to Supabase. `src/data/restaurants.ts` already supports this.

To fully migrate all pages to backend, say "migrate frontend to backend" and I'll update Checkout, Admin, Owner, Deliverer dashboards.

## Project Structure

```
src/
  components/       # UI + BackendStatus badge
  pages/            # Index, RestaurantPage, Checkout, Admin, etc.
  data/restaurants.ts # now supports both Supabase and backend
  lib/backend.ts    # NEW - backend client
  integrations/supabase/ # original Supabase client
server/             # NEW - fresh backend
  src/
    index.ts
    app.ts
    routes/         # restaurants, menu, orders, auth, admin, payments
    db/store.ts     # JSON persistence
    db/seed.ts
  data/db.json      # gitignored, auto-created
```

## Scripts

| Script | What |
|--------|------|
| `npm run dev` | frontend only (8080) |
| `npm run dev:backend` | backend only (3001) |
| `npm run dev:all` | both concurrently |
| `npm run build` | build frontend to dist/ |
| `npm run backend:seed` | seed backend DB |
| `npm run backend:build` | build backend to server/dist |
| `npm run backend:start` | start backend (serves frontend dist too) |

## Deployment Options

- **Vercel/Netlify**: Deploy frontend `dist/` as before
- **Render/Railway/Fly**: Deploy `server/` folder
- **Single server**: `npm run build && cd server && npm start` serves both on :3001
- **Docker**: Ask me to create Dockerfile

## Why Fresh Backend?

Original repo:
- No `server/` folder
- `npm run build` only built frontend
- Backend logic hidden in Supabase dashboard (remote)
- Hard to see logs, debug, or develop offline

New backend:
- Visible folder, logs, `curl`able
- No external DB needed for dev
- Mirrors all Supabase edge functions
- Ready to deploy anywhere
- Data in `server/data/db.json` you can inspect

See `BACKEND_GUIDE.md` for full story.
