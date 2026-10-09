# Dispatch Migration — Runbook

**Migration:** `supabase/migrations/20261005120000_dispatch_core.sql`
**Closes:** G1 (no dispatch model), G2 (unconstrained order status) from `docs/ROMA-ARCHITECTURE-AUDIT.md`
**Verification:** `npm run test:db` — 35 assertions against real PostgreSQL 18, all passing

---

## ⚠️ This deploy is COUPLED. Read this first.

**The migration renames the order-status vocabulary. The frontend still speaks the old one. If you run the migration without shipping the client change in the same deploy, three dashboards break silently.**

Verified breakage — 17 literals across 3 files:

| File | Old literal | Post-migration reality |
|---|---|---|
| `src/pages/AdminDashboard.tsx` | `order.status === "New"` (×2) | never matches — **the Accept button disappears entirely** |
| `src/pages/AdminDashboard.tsx` | `updateStatus(order.id, "Accepted")` | caught by the CHECK constraint |
| `src/pages/DelivererDashboard.tsx` | `status !== "Delivered"` | **every order shows as active, none as completed** |
| `src/pages/DelivererDashboard.tsx` | `case "New" / "Accepted" / "Picked Up" / "Delivered"` | all fall through to the default colour |
| `src/pages/OwnerDashboard.tsx` | `STATUSES = ["New", …]` | filter chips return nothing |
| `src/pages/OwnerDashboard.tsx` | `order.status === "New"` | **"new orders" count reads 0 forever** |

None of these throw. They fail silently — a dashboard that renders, but is wrong. That is worse than a crash, because nobody notices until a customer is told their order can't be found.

**The client change replaces these literals with the canonical union in `src/domain/order/status.ts`.** Ship both together.

### A separate bug this surfaced
`OwnerDashboard.tsx` lists `"On the Way"` in its `STATUSES` array. **No such status exists** in the database, in the transitions table, or in the CHECK constraint. It was never a real state. It is removed by the client change rather than carried forward — do not add it to the constraint to make the old array "work".

---

## Pre-flight (run in production BEFORE applying)

### 1. Enumerate the live vocabulary
```sql
SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY 2 DESC;
```
Map every result through the table below. **If any value is not on the left, stop.** Section 2 of the migration will abort with `Unmapped order status value(s) present: …` rather than guess — that abort is a feature, not a failure.

| Live value | Canonical |
|---|---|
| `New` | `pending` |
| `Accepted` | `accepted` |
| `Preparing` | `preparing` |
| `Ready` | `ready` |
| `Picked Up` | `picked_up` |
| `Delivered` | `delivered` |
| `Cancelled` | `cancelled` |
| `Failed` | `failed` |

### 2. Confirm the in-flight order volume
```sql
SELECT count(*) FROM public.orders WHERE status NOT IN ('Delivered','Cancelled','Failed');
```
**Apply this migration during a quiet window.** Orders mid-flight during the rename keep their row, but any driver app instance still running the old bundle will show stale statuses until it is reloaded. There is no way to avoid this — the vocabulary is changing underneath a live client.

### 3. Back up
```sql
CREATE TABLE public.orders_backup_20261005 AS SELECT * FROM public.orders;
```

---

## Apply

```bash
supabase db push
```

The migration is **idempotent**: every statement uses `IF NOT EXISTS`, `CREATE OR REPLACE`, or a guarded `UPDATE`. Re-running it is safe.

---

## Post-flight verification

### 1. Vocabulary converted, nothing stuck
```sql
SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY 2 DESC;
```
Expect only canonical values. Compare the total against pre-flight — it must be identical.

### 2. The default is corrected (defect D1)
```sql
SELECT column_default FROM information_schema.columns
 WHERE table_name='orders' AND column_name='status';
```
**Must be `'pending'::text`.** If it is still `'New'`, every order insert that omits `status` will now fail the CHECK constraint — i.e. **customers cannot place orders.** This was the single most dangerous defect found.

### 3. The cash trigger still fires (defect D2)
```sql
SELECT id, payment_status, paid_at FROM public.orders
 WHERE payment_method = 'cash' AND status = 'delivered'
 ORDER BY created_at DESC LIMIT 5;
```
Expect `payment_status = 'paid'`. **If cash orders sit at `'pending'`, the trigger is still matching the old `'Delivered'` literal and cash is silently not being recorded as collected.** This is a money bug — check it explicitly, do not assume.

### 4. No deliverer can see unassigned work
Sign in as a driver account with no assignments and confirm the order list is **empty**. Before this migration it showed every order in the system, including customer names, phone numbers and addresses (a POPIA exposure).

---

## Rollback

The status rename is not automatically reversible, but it is mechanical:

```sql
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
UPDATE public.orders SET status = CASE status
  WHEN 'pending' THEN 'New'   WHEN 'accepted'  THEN 'Accepted'
  WHEN 'preparing' THEN 'Preparing' WHEN 'ready' THEN 'Ready'
  WHEN 'picked_up' THEN 'Picked Up' WHEN 'delivered' THEN 'Delivered'
  WHEN 'cancelled' THEN 'Cancelled' WHEN 'failed'   THEN 'Failed'
  ELSE status END;
ALTER TABLE public.orders ALTER COLUMN status SET DEFAULT 'New';
```
`assigned` has no legacy equivalent — check for `assigned` rows before rolling back and resolve them by hand.

Then revert the client. **Roll back both together or neither.**

---

## What the test suite does NOT cover

Stated plainly, so this is not over-trusted:

- **Concurrency.** PGlite is single-connection. `FOR UPDATE SKIP LOCKED` is verified for its predicate and its `order_unavailable` path, but **no true two-session race is simulated.** Before go-live, open two browser sessions as two drivers, put an order in `ready`, and tap Claim simultaneously. Exactly one must succeed. If both succeed, stop and escalate — that is the race the whole design exists to prevent.
- **Supabase's real auth stack.** `auth.uid()` is shimmed from a GUC rather than a JWT.
- **PostgREST wire format.** Functions are called directly by the test. This is precisely why `claim_order` and `transition_order_status` return `jsonb` instead of composites — composite return types are ambiguous over PostgREST.
- **Timezone edge at midnight.** The window function is cross-checked against an independent JS computation, but only at whatever time the suite happens to run.

---

## Follow-ups (NOT in this slice)

1. **`delivery_fee_cents` is now canonical, but `delivery_fee NUMERIC(10,2)` still exists** and both `create-order` and the client still write the numeric. Two sources of truth for money is a live defect — one writes R15, the other reads R20. Reconcile next; it is the "one source of truth" work in audit §7.
2. **The delivery fee is a flat R15** with no distance basis. Now that `delivery_zone` exists, distance/zone pricing becomes possible. That is the next architectural decision after dispatch works.
3. **`deliverer_id` writes are now impossible via direct UPDATE** (by design). Any existing client code that assigned orders by updating the row will silently affect 0 rows rather than erroring — the same RLS behaviour the test asserts. Audit `src/` for direct `deliverer_id` writes before deploying; there are none today, but this is the trap to watch.

---

## Reference: what the harness found that reading did not

| Defect | Would have caused |
|---|---|
| `DEFAULT 'New'` vs the new CHECK | **Every order insert fails.** Customers cannot order. |
| `trg_mark_cash_paid` matching `'Delivered'` | Cash orders never recorded as paid. Silent revenue loss. |
| `list_open_jobs` referencing `r.suburb`, `o.delivery_suburb`, `o.delivery_fee_cents` | Migration aborts — those columns did not exist. |
| One migration read as "empty" (`wc -l` = 0) | Nearly discarded a load-bearing `ALTER PUBLICATION` that drives all dashboard live updates. It is 60 bytes with no trailing newline. |

None of these were visible by reading the SQL. All four surfaced by executing it.
