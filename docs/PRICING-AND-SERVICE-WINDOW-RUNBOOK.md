# Pricing & Service Window — Runbook

**Migration:** `supabase/migrations/20261005140000_pricing_and_service_window.sql`
**Depends on:** `20261005120000_dispatch_core.sql` (must be applied first — this one uses `orders.delivery_zone` and `orders.delivery_fee_cents`)
**Closes:** the "two sources of truth for money" defect and the ordering half of G5
**Verified by:** `npm run test:db` — 77 assertions against real PostgreSQL 18, all passing

---

## ⚠️ THIS FIXES A P0 THAT THE PREVIOUS SLICE INTRODUCED

**Order creation was completely broken between the dispatch migration and this one.**

`supabase/functions/create-order/index.ts` wrote `status: 'New'`. The dispatch migration added `orders_status_check`, which permits only the lowercase vocabulary. Every order insert therefore failed the CHECK constraint. Customers could not place orders at all.

**Why it was missed, precisely.** The dispatch work grepped `src/` for legacy status literals and `supabase/migrations/` for how status was written. It never grepped `supabase/functions/`. The database test suite seeds rows directly and never exercises the edge function. The TypeScript build cannot see inside a Deno edge function. So four independent guards were all blind to the one file that mattered, and the defect was found by reading, not by testing.

**What now prevents a recurrence.** `src/domain/order/status.contract.test.ts` statically scans every `.ts`/`.tsx` file under `src/` **and** `supabase/functions/`, strips comments, and fails if any status-bearing expression uses a non-canonical value. It also asserts the client union matches the database CHECK constraint exactly.

That guard was verified by **negative control**, not by assertion: injecting `status: 'New'` back into the edge function produces `exit 1` and names the offending file. An earlier version of that experiment reported `exit 1` for the wrong reason — a bad test path, not a failure — so the control was re-run properly against the correct path. A guard that has never been observed failing is not a guard.

---

## What changed

### 1. The fee existed in four places. It now exists in one.
| Before | After |
|---|---|
| `src/pages/Checkout.tsx`: `const DELIVERY_FEE = 15` | deleted |
| `create-order/index.ts`: `const DELIVERY_FEE = 15` | deleted |
| `orders.delivery_fee` `NUMERIC DEFAULT 15.00` | derived from cents by trigger |
| `orders.delivery_fee_cents` `DEFAULT 1500` | **authoritative** |

There is now one pricing implementation, `public.quote_order()`. It is called by the checkout screen to *display* a total and by `create-order` to *charge* one. They cannot disagree because there is only one of them.

**The client no longer computes money at all.** `src/domain/order/pricing.ts` contains formatting and nothing else — deliberately no subtotal, no multiplication, no fee addition. That absence is the design, and it is the reason a future zone- or distance-based pricing change cannot silently desynchronise the displayed total from the charged total.

### 2. Money is integer cents everywhere
The old code used `Math.round(x * 100) / 100` on floats. Exact decimal arithmetic in cents removes that class of bug. `orders.delivery_fee` (numeric rands) is retained for backward compatibility but is now **derived** by a `BEFORE` trigger — writing it directly has no effect, because cents win. Test 19 proves this both ways.

### 3. The service window is configuration, not code
`is_within_service_window()` previously hardcoded `08:00` and `16:00` and Mon-Fri. The operator could not change their own trading hours without a database migration. There is now a single-row `service_config` table, and test 15 proves changing it takes effect immediately.

**A distinction worth the operator's attention:**

- The window **always** governs dispatch. A rider can never claim outside it. That is enforced in `claim_order()` and is not configurable.
- `accept_orders_outside_window` governs only whether a customer may **place** an order outside it. Default `false`.

With the default, a customer at 03:00 gets a clear "we're closed, order from Monday 08:00" instead of a confirmed order and a taken payment for a delivery nobody can make. Set it to `true` if you want to bank tomorrow's orders overnight — the orders will queue as `pending` until riders start.

`public.service_availability()` returns the full state including `nextOpenAt`, so the UI never re-derives opening logic in JavaScript.

### 4. Delivery zones — placeholder prices, real structure
Five bands, seeded with the geography verified during this work: Mamelodi ~16 km east of Church Square, Atteridgeville west, Soshanguve/Mabopane north-west, Centurion south.

> **⚠️ The fees (R15 / R25 / R25 / R30 / R35) are PLACEHOLDER DEFAULTS, not researched prices.** They are a coarse distance-band model chosen to be operationally simple. **Set real prices before launch.** Change the `delivery_zones` table, not the code.

> **⚠️ These are groupings, not geofences.** There are no polygons and no coordinates yet, so `orders.delivery_zone` is supplied by the client and is therefore **unverified** — a caller could under-declare their zone and pay less. The geo slice (G4) adds lat/lng, real polygons and server-side zone derivation. Until then the zone is a pricing hint, not a boundary.

### 5. `quote_order()` validates before the customer pays
Mixed-restaurant baskets, unavailable items, oversized baskets, unknown zones and malformed UUIDs are all rejected at quote time with specific codes rather than at placement. Client-supplied prices are ignored — test 18 proves a tampered `unitPriceCents: 1` is discarded in favour of the menu price.

### 6. A clearer failure when someone reintroduces a legacy status
A `CHECK` constraint cannot tell you *which* caller is wrong. A `BEFORE` trigger now raises `Invalid order status New. The canonical values are lowercase: … See src/domain/order/status.ts.`

### 7. Currency formatting
`R 15,00`, not `R 15.00`. The previous `toFixed(2)` used a period, which a South African reader parses as a **thousands separator** — "R 1.50" could be read as fifteen hundred rand. Now consistent with the `en-ZA` locale used elsewhere in the app.

---

## Deploy order

```bash
# 1. Dispatch first (this migration depends on its columns)
supabase db push --include 20261005120000_dispatch_core.sql
# 2. Then pricing
supabase db push --include 20261005140000_pricing_and_service_window.sql
```

Both are idempotent. **Ship the client in the same deploy** — checkout now calls `quote_order` and will show `—` instead of a total if the RPC is absent.

## Post-flight verification

### 1. Order creation actually works (the P0)
Place a real order. It must succeed. Then:
```sql
SELECT status, count(*) FROM public.orders
 WHERE created_at > now() - interval '1 hour' GROUP BY status;
```
Expect rows in `pending`. **Any `Invalid order status` error means a caller is still writing the legacy vocabulary** — the trigger message names the offending value.

### 2. The fee is single-sourced
```sql
SELECT DISTINCT delivery_zone, delivery_fee, delivery_fee_cents
  FROM public.orders WHERE created_at > now() - interval '1 hour';
```
`delivery_fee_cents / 100` must equal `delivery_fee` for every row.

### 3. The window is enforced and reports correctly
```sql
SELECT public.service_availability();
```
Outside 08:00–16:00 Mon–Fri, expect `canOrder: false` and a non-null `nextOpenAt` pointing at the next weekday 08:00 SAST.

### 4. Configure your real prices and hours
```sql
UPDATE public.service_config SET open_time='08:00', close_time='16:00', open_days='{1,2,3,4,5}';
UPDATE public.delivery_zones SET fee_cents = <your price> WHERE code = 'central';
```

## Rollback

Drop this migration's objects; the dispatch schema is unaffected.
```sql
DROP TRIGGER IF EXISTS trg_sync_delivery_fee ON public.orders;
DROP TRIGGER IF EXISTS trg_explain_status_check ON public.orders;
DROP FUNCTION IF EXISTS public.sync_delivery_fee_numeric();
DROP FUNCTION IF EXISTS public.explain_status_check();
DROP FUNCTION IF EXISTS public.quote_order(jsonb, text);
DROP FUNCTION IF EXISTS public.service_availability();
DROP TABLE IF EXISTS public.delivery_zones;
DROP TABLE IF EXISTS public.service_config;
```
`is_within_service_window()` must then be restored to a literal-based definition, or `claim_order()` will fail on a missing table. **Revert the client too** — checkout depends on `quote_order`.

## What the tests do NOT cover

- **The edge function itself.** The suite applies real migrations and exercises real SQL, but `create-order` runs on Deno and is not executed. The contract test statically checks its status literal; the rest of its behaviour is verified only by reading. **Place one real order end-to-end before considering this done.**
- **Concurrency** — still unproven, as noted in the dispatch runbook. PGlite is single-connection.
- **Zone correctness.** The client supplies the zone and nothing verifies it. A customer can under-declare. This is the known G4 gap, not an oversight.
- **DST.** South Africa has none, but `service_availability()` uses the named timezone regardless so it survives any tzdata change.

## Follow-ups

1. **Set real zone prices** (placeholder values ship today).
2. **`orders.subtotal_cents` / `total_cents`** — the numeric rand columns remain the stored totals. `create-ikhokha-payment` converts with `Math.round(Number(total) * 100)`, which is safe for `NUMERIC(10,2)` values but is the last place the numeric representation touches the payment path.
3. **Scheduled orders** — `accept_orders_outside_window` is a blunt switch. A real slot-picker would let a customer choose a delivery window rather than merely bank a `pending` order.
4. **G4 geo slice** — polygons, coordinates, server-side zone derivation, and the end of client-declared zones.
