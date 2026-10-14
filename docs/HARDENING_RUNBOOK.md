# Roma.africa — Database Hardening Runbook

> **Status:** Active plan. Supersedes any earlier "reset and rebuild" proposals.
> **Owner:** Platform / backend.
> **Last reviewed:** 2026-10-13.

This runbook assumes the repo's existing vocabulary: `restaurants`, `deliverer`, `user`. Do not rename tables, columns, or roles as part of this work — renames are cosmetic and add churn without product value.

---

## Table of contents

- [Context](#context)
- [Conventions](#conventions)
- [How to use this document](#how-to-use-this-document)
- [Phase 0 — Safety net](#phase-0--safety-net)
- [Phase 1 — Deliverer scoping (P0)](#phase-1--deliverer-scoping-p0)
- [Phase 2 — Safe additive hardening (P1)](#phase-2--safe-additive-hardening-p1)
- [Phase 3 — Order status unification (P2)](#phase-3--order-status-unification-p2)
- [Phase 4 — Money representation](#phase-4--money-representation)
- [Phase 5 — Payments hardening](#phase-5--payments-hardening)
- [Phase 6 — Ongoing hygiene](#phase-6--ongoing-hygiene)
- [Appendix A — RLS test matrix](#appendix-a--rls-test-matrix)
- [Appendix B — Rollback plans](#appendix-b--rollback-plans)
- [Appendix C — Agent prompt template](#appendix-c--agent-prompt-template)
- [Appendix D — Frozen canonical values](#appendix-d--frozen-canonical-values)

---

## Context

Roma.africa is currently a hardened MVP, not a prototype. Recent migrations locked down RLS, moved order creation behind a `create-order` Edge Function running as `service_role`, and pinned function privileges. The generated `src/integrations/supabase/types.ts` is in sync with prod.

The findings in `docs/DATABASE_STATE.md` (§9 has the live-verification queries) establish that:

1. Deliverers hold a global `orders` UPDATE capability — any deliverer can rewrite any order including money columns.
2. `orders.restaurant_id` has no FK, so a restaurant delete leaves orphaned order history.
3. Three dashboards write three different vocabularies to an unconstrained `TEXT` status column.
4. Indexes are missing on the columns the dashboards filter by.

**The reset-and-rebuild approach is off the table.** These fixes are additive and incremental. Nothing in this runbook requires downtime, dropping tables, or a schema swap.

---

## Conventions

- **Migrations** live in `supabase/migrations/`, timestamped, forward-only. Never edit a migrated file.
- **Idempotency** where possible: `add column if not exists`, `drop policy if exists`, `create or replace function`. This makes local resets cheap.
- **`security definer` functions** must set `search_path = ''` and fully qualify identifiers (`public.`, `private.`, `auth.`).
- **Escape hatches in triggers** use exactly two allow-checks: `auth.uid() is null` (service_role / webhook / migration) and `public.has_role('admin')`.
- **Enums over text** — new state machines are enums. Existing text columns are converted only after backfill.
- **Money in integer cents** — long-term target. See [Phase 4](#phase-4--money-representation).
- **Production writes** are never performed by the agent. Prompts that need prod data explicitly stop and ask the operator to run queries in the Supabase SQL editor.

---

## How to use this document

Phases are ordered by priority, not by dependency. Each phase ships as its own PR (or set of PRs), tested on staging before prod, and each is independently reversible. Read the relevant phase end-to-end before writing any code.

**Do not batch phases.** Phase N+1 depends on Phase N being deployed and verified. The agent prompts in [Appendix C](#appendix-c--agent-prompt-template) enforce this.

**Deploy order per phase.** Migrations first, then Edge Functions, then frontend — unless the phase says otherwise. Where a phase requires a specific order (Phase 3.5 in particular), it's called out inline.

**Test plan per phase.** Every phase has a test plan. On staging, never prod. Phase 1 and Phase 3 have tests that must pass before prod deployment.

---

## Phase 0 — Safety net

**Goal:** Prove the local migration chain works, add CI, stand up staging. Do this before touching anything.

**Why first:** Every subsequent phase runs `supabase db reset` locally and depends on CI catching regressions. If reset doesn't work, none of the later phases can be tested safely.

### 0.1 Commit the docs

- `docs/DATABASE_STATE.md` — the reconstruction report.
- `docs/proposed-migration-db-hardening.sql` — the draft migration SQL. Prepend:
  ```
  -- DRAFT — do not apply. See docs/HARDENING_RUNBOOK.md.
  ```
- `docs/HARDENING_RUNBOOK.md` — this file.

PR title: `docs: database state report + hardening draft`

### 0.2 Run verification queries against prod

Every query in §9 of `docs/DATABASE_STATE.md` is run in the Supabase SQL editor. Results are pasted back to the agent as a comment on the PR.

Purpose: reconcile the static reconstruction (from migrations + `src/`) against the actual production schema. Any drift means either (a) a prod change that was never migrated to the repo, or (b) a migration in the repo that was never applied to prod.

### 0.3 Fix drift

- **Prod-only change:** create a new timestamped migration that reconstructs it. Prefix the file comment with `-- reconstructed from prod at <date>`.
- **Repo-only change:** report and stop. Operator decides whether the migration is dead (`rm`) or pending (`supabase db push`).
- **No drift:** skip.

### 0.4 `supabase db reset` must be green locally

```
supabase start
supabase db reset
supabase db lint
```

If it fails, isolate the broken migration and fix it before proceeding. The broken migration is either one that assumes state from a deleted migration, or a semicolon inside a `$$ ... $$` block that a naive splitter can't handle — the CLI can handle this correctly, so a local failure points to a real issue, not a tooling bug.

### 0.5 Add CI

`.github/workflows/supabase-ci.yml` runs on any PR touching `supabase/migrations/**`:

```yaml
name: Supabase CI

on:
  pull_request:
    paths:
      - 'supabase/migrations/**'
      - '.github/workflows/supabase-ci.yml'

jobs:
  verify-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase start
      - run: supabase db reset
      - run: supabase db lint
      - if: always()
        run: supabase stop --no-backup
```

This is the regression net for every later phase.

### 0.6 Staging project

Either:
- **Supabase Branch** (paid plans) — one branch per PR, isolated DB, tuned to production schema.
- **Second hosted project** — manual `supabase link --project-ref <staging>` and `supabase db push`.

Point a Vercel preview deploy at the staging project via a preview-scoped env var. Later phases test end-to-end against this.

**Deploy:** docs and CI only. Zero user impact.

**Rollback:** revert the docs branch. CI file removal has no effect on prod.

### 0.7 Post-verification findings (2026-10-13)

- All 14 §9 queries reconciled. Zero drift. No reconstruction migrations required.
- `public.orders` is empty (Query 3 returned 0 rows). The database is pre-launch. Downstream effects: Phase 3.4 backfill is a no-op; Phase 3.3's 24h observation wait is unnecessary; Phase 3.5's `USING` cast is zero-risk; Phase 4's money conversion is a one-shot migration, not expand/contract; Phase 1.8 test matrix requires seeded order fixtures.
- `orders.restaurant_id` is `integer NOT NULL` in prod. Phase 2.3 FK must use `on delete restrict`, not `set null`.
- Live `orders` deliverer UPDATE policy name is exactly `Deliverers can update orders`, condition `has_role(auth.uid(), 'deliverer'::app_role)`. Phase 1.3's `drop policy` must use this exact name.

---

## Phase 1 — Deliverer scoping (P0)

**Goal:** A deliverer can only read/write orders where `orders.deliverer_id = auth.uid()`. Even on their assigned orders, they cannot touch `total`, `subtotal`, `delivery_fee`, `service_fee`, `tip`, `user_id`, `restaurant_id`, or `payment_status`.

**Why P0:** This is the only finding with a direct loss vector. Everything else is either integrity, performance, or developer velocity. This is money.

**Two layers, both required:**
- **Row scoping** (RLS) — a deliverer can't see orders that aren't theirs.
- **Column protection** (trigger) — even on their own orders, they can't rewrite financial columns.

Shipping only the trigger leaves the "mark any order delivered" hole open. Shipping only the policy leaves them able to edit money on their own orders. Both ship together, in the same PR.

### 1.1 Reconnaissance

Run these in the Supabase SQL editor and paste back:

```sql
-- Does the column exist?
select column_name
from information_schema.columns
where table_name = 'orders' and column_name = 'deliverer_id';

-- How many active deliverers, active orders?
select count(*) from public.user_roles where role = 'deliverer';
select id, status, deliverer_id
from public.orders
where status not in ('Delivered', 'Cancelled')
order by created_at desc
limit 20;

-- Current policy definitions on orders
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'orders'
order by cmd, policyname;
```

### 1.2 Migration A — `orders_deliverer_id.sql`

```sql
-- Phase 1.2 — deliverer_id column + index.
-- Rollback: drop index orders_deliverer_id_idx; alter table public.orders drop column deliverer_id;

alter table public.orders
  add column if not exists deliverer_id uuid
  references public.profiles(id) on delete set null;

create index if not exists orders_deliverer_id_idx
  on public.orders (deliverer_id)
  where deliverer_id is not null;
```

### 1.3 Migration B — `orders_deliverer_policy_scoped.sql`

Replace the exact policy name reported in step 1.1. If the current policy is named `"deliverer update orders"` but the recon says something else, use the reported name — a `drop policy if exists` with a typo silently does nothing.

```sql
-- Phase 1.3 — scope deliverer access to their own orders.
-- Rollback: drop the scoped policy, recreate the previous loose version from git history.

drop policy if exists "deliverer update orders" on public.orders;

create policy "deliverer update assigned orders"
on public.orders
for update
to authenticated
using (
  public.has_role('deliverer')
  and deliverer_id = auth.uid()
)
with check (
  deliverer_id = auth.uid()
);

-- Also scope the SELECT policy if it isn't already scoped.
drop policy if exists "deliverer read orders" on public.orders;

create policy "deliverer read assigned orders"
on public.orders
for select
to authenticated
using (
  public.has_role('deliverer')
  and deliverer_id = auth.uid()
);
```

Adjust the two `drop policy if exists` names to match the recon. If the current SELECT policy is already scoped (uncommon — most MVPs allow "any deliverer reads all orders"), keep it and skip the second drop.

### 1.4 Migration C — `orders_protect_money_columns.sql`

```sql
-- Phase 1.4 — block money/ownership column edits by non-admins.
-- Rollback: drop trigger orders_protect_money; drop function public.protect_order_money_columns();

create or replace function public.protect_order_money_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role / webhook / migration context
  if auth.uid() is null then
    return new;
  end if;

  -- admins may edit anything
  if public.has_role('admin') then
    return new;
  end if;

  if new.total          is distinct from old.total
  or new.subtotal       is distinct from old.subtotal
  or new.delivery_fee   is distinct from old.delivery_fee
  or new.service_fee    is distinct from old.service_fee
  or new.tip            is distinct from old.tip
  or new.user_id        is distinct from old.user_id
  or new.restaurant_id  is distinct from old.restaurant_id
  or new.payment_status is distinct from old.payment_status
  then
    raise exception 'cannot edit money or ownership columns'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_protect_money on public.orders;

create trigger orders_protect_money
  before update on public.orders
  for each row
  execute function public.protect_order_money_columns();
```

### 1.5 Edge Function — `assign-deliverer`

`supabase/functions/assign-deliverer/index.ts`:

- Method: `POST`.
- Body: `{ order_id: uuid, deliverer_id: uuid }`.
- Auth: reads the caller's JWT from the `Authorization` header, resolves the user via `supabase.auth.getUser(jwt)`, checks `user_roles` for `role='admin'` via the service-role client.
- If not admin: `403`.
- If admin: `UPDATE orders SET deliverer_id = $1 WHERE id = $2` via the service-role client.
- Returns: `{ ok: true, order_id }`.
- Emits a notification row for the deliverer (channel: `push`, template: `delivery_assigned`).

Deploy with `supabase functions deploy assign-deliverer`.

### 1.6 Frontend — admin dashboard

Add an "Assign deliverer" action to each order row. Currently the "ready for pickup" string may be `Ready`, `Ready for Pickup/Delivery`, or similar — check `src/` for the exact string. Enable the action when status matches. The action:

1. Opens a picker listing users with `role='deliverer'` (query `user_roles` joined to `profiles`).
2. Calls `assign-deliverer` via `supabase.functions.invoke`.
3. Refreshes the order row.

### 1.7 Frontend — deliverer dashboard

Add `.eq('deliverer_id', user.id)` to every query that reads `orders`. This is belt-and-braces — RLS enforces it — but an empty result set is a much worse debugging experience than a scoped filter that returns nothing.

### 1.8 Test matrix (staging, mandatory before prod)

Four users: `admin`, `restaurant_owner`, `deliverer_A`, `deliverer_B`.

| Test | Expected |
|---|---|
| Admin assigns order O to deliverer_B | 200, `orders.deliverer_id = B` |
| deliverer_A `select * from orders where id = O` | 0 rows |
| deliverer_A `update orders set status='Picked Up' where id=O` | 0 rows affected |
| deliverer_B `select * from orders where id = O` | 1 row |
| deliverer_B `update orders set status='Picked Up' where id=O` | 1 row affected |
| deliverer_B `update orders set total=1 where id=O` | raises `cannot edit money or ownership columns` (42501) |
| admin `update orders set total=1 where id=O` | succeeds |
| deliverer_A calls `assign-deliverer` for any order | 403 |
| admin calls `assign-deliverer` for order O, deliverer=B | 200 |

### 1.9 Deploy order

1. Apply migrations A, B, C to prod (in that order).
2. Smoke-test: admin dashboard order update still works.
3. Deploy the Edge Function.
4. Merge the frontend PR.

### 1.10 Rollback

- Drop the trigger: `drop trigger orders_protect_money on public.orders;`
- Restore the loose policy: recreate from git history.
- `deliverer_id` column stays — it's additive and harmless.

---

## Phase 2 — Safe additive hardening (P1)

**Goal:** FK integrity, indexes, check constraints. No frontend changes, no user-visible behavior change.

**Why P1:** Prevents future data corruption and unblocks scale. Zero coordination overhead.

### 2.1 Pre-flight checks

Run these in the Supabase SQL editor and paste back:

```sql
-- Dangling restaurant_id values
select count(*) from public.orders o
where o.restaurant_id is not null
  and not exists (select 1 from public.restaurants r where r.id = o.restaurant_id);
-- must be 0

-- Negative totals
select count(*) from public.orders where total < 0;
-- must be 0

-- Non-positive quantities
select count(*) from public.order_items where quantity <= 0;
-- must be 0

-- Is restaurant_id nullable?
select is_nullable
from information_schema.columns
where table_name = 'orders' and column_name = 'restaurant_id';
```

**`restaurant_id` is `integer NOT NULL` in prod (confirmed Phase 0.2).** The FK in §2.3 must use `on delete restrict`. Because restrict blocks deleting a restaurant that has historical orders, Phase 2 also adds `restaurants.deleted_at timestamptz` so restaurants can be soft-deleted. All dashboard queries that list restaurants must add `where deleted_at is null`.

### 2.2 Indexes

```sql
-- Phase 2.2 — indexes on dashboard filter columns.
-- Rollback: drop index <name>;

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

create index if not exists orders_restaurant_created_idx
  on public.orders (restaurant_id, created_at desc);

create index if not exists order_items_order_idx
  on public.order_items (order_id);

create index if not exists menu_items_restaurant_idx
  on public.menu_items (restaurant_id);
```

**Do not** use `CREATE INDEX CONCURRENTLY` — Supabase migrations run in a transaction, and `CONCURRENTLY` cannot run inside one. For the row counts Roma currently has, a plain `CREATE INDEX` takes milliseconds.

### 2.2b Soft-delete column on restaurants

```sql
-- Phase 2.2b — soft-delete column, required because 2.3 uses on delete restrict.
-- Rollback: alter table public.restaurants drop column deleted_at;

alter table public.restaurants
  add column if not exists deleted_at timestamptz;

create index if not exists restaurants_active_idx
  on public.restaurants (id)
  where deleted_at is null;
```

Frontend must add `where deleted_at is null` to every query that lists restaurants. This is part of the Phase 2 frontend checklist even though Phase 2 was nominally backend-only.

### 2.3 Foreign key, added NOT VALID then validated

```sql
-- Phase 2.3 — restaurant FK.
-- Rollback: alter table public.orders drop constraint orders_restaurant_fk;

alter table public.orders
  add constraint orders_restaurant_fk
  foreign key (restaurant_id)
  references public.restaurants(id)
  on delete restrict   -- 2.1 confirmed NOT NULL
  not valid;

alter table public.orders
  validate constraint orders_restaurant_fk;
```

`not valid` + `validate` runs the constraint check without holding a full-table lock during the ADD. For prod with active writes, this is the difference between a brief blip and a hang.

### 2.4 Check constraints

```sql
-- Phase 2.4 — basic integrity checks.
-- Rollback: alter table ... drop constraint <name>;

alter table public.orders
  add constraint orders_total_nonneg
  check (total >= 0) not valid;
alter table public.orders
  validate constraint orders_total_nonneg;

alter table public.order_items
  add constraint order_items_qty_pos
  check (quantity > 0) not valid;
alter table public.order_items
  validate constraint order_items_qty_pos;
```

### 2.5 Verify

```
supabase db reset
supabase db lint
```

Both green. Merge.

### 2.6 Rollback

Drop any of the added constraints or indexes. Non-breaking either way — no application code depends on them.

---

## Phase 3 — Order status unification (P2)

**Goal:** One canonical status set across all three dashboards. Enforced by a Postgres enum and a BEFORE UPDATE transition trigger.

**Why P2:** Largest blast radius, but also the fix for the cash-auto-paid trigger bug that only fires on one spelling of "Delivered". Do this last because it touches every dashboard in one coordinated release.

**Canonical vocabulary** (frozen, see [Appendix D](#appendix-d--frozen-canonical-values)):

| Value | Meaning | Who writes it |
|---|---|---|
| `pending_payment` | Order created, webhook not received | `create-order` Edge Function |
| `paid` | Payment confirmed, awaiting restaurant | webhook handler |
| `preparing` | Restaurant accepted, cooking | restaurant_owner |
| `ready_for_pickup` | Restaurant marked ready | restaurant_owner |
| `picked_up` | Deliverer collected | deliverer |
| `delivered` | Terminal — successful | deliverer |
| `cancelled` | Terminal — cancelled | customer, restaurant_owner, admin |

**Explicitly excluded:**
- `accepted` — covered by `paid` → `preparing` transition.
- `on_the_way` — derived from `picked_up` + live GPS, not stored.
- `refunded` — separate concern; belongs on `payment_status`, not `order_status`.

### 3.1 Snapshot prod

```sql
select status, count(*) from public.orders group by 1 order by 2 desc;
```

Record the result. Every distinct string needs a mapping to canonical before 3.5 can run.

### 3.2 Freeze

Announce to the team: no new status strings are introduced from this point forward. Every write uses one of the seven canonical values. Code review enforces this manually until 3.5 lands the enum.

### 3.3 PR — Frontend harmonisation (no schema change)

- Find every write of `order.status` in `src/`. Change to canonical values.
- Find every read of `order.status`. Route through `normaliseStatus(raw)`.
- Create `src/lib/order-status.ts`:

```ts
export type CanonicalStatus =
  | 'pending_payment'
  | 'paid'
  | 'preparing'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'delivered'
  | 'cancelled';

const LEGACY_MAP: Record<string, CanonicalStatus> = {
  // Populate from the prod snapshot in 3.1. Example entries:
  'Accepted':                       'paid',
  'New':                            'paid',
  'Preparing':                      'preparing',
  'Ready':                          'ready_for_pickup',
  'Ready for Pickup/Delivery':      'ready_for_pickup',
  'Picked Up':                      'picked_up',
  'On the Way':                     'picked_up',
  'Delivered':                      'delivered',
  'Cancelled':                      'cancelled',
  'Canceled':                       'cancelled',
};

export function normaliseStatus(raw: string): CanonicalStatus {
  if (raw in LEGACY_MAP) return LEGACY_MAP[raw];
  return raw as CanonicalStatus;
}

export function isCanonical(s: string): s is CanonicalStatus {
  return [
    'pending_payment','paid','preparing','ready_for_pickup',
    'picked_up','delivered','cancelled',
  ].includes(s);
}
```

Deploy. **Wait 24 hours** with green dashboards before proceeding to 3.4.

### 3.4 Migration — `order_status_backfill.sql`

**Pre-launch no-op.** `public.orders` is empty as of 2026-10-13 (see §0.7). This migration exists for the day orders begin writing, but currently affects 0 rows. Apply the enum swap in §3.5 directly.

```sql
-- Phase 3.4 — backfill legacy statuses to canonical.
-- Rollback: not reversible without a snapshot of pre-backfill state. Take pg_dump first.

update public.orders set status = 'paid'
  where status in ('Accepted','New');

update public.orders set status = 'preparing'
  where status in ('Preparing');

update public.orders set status = 'ready_for_pickup'
  where status in ('Ready','Ready for Pickup/Delivery');

update public.orders set status = 'picked_up'
  where status in ('Picked Up','On the Way');

update public.orders set status = 'delivered'
  where status in ('Delivered','Complete','Done');

update public.orders set status = 'cancelled'
  where status in ('Cancelled','Canceled');

-- Verification — must return only canonical values:
select status, count(*) from public.orders group by 1;
```

Adjust mapping to match 3.1's snapshot. Any leftover value is an unmapped spelling. **Do not proceed to 3.5 until the verification query returns only canonical values.**

### 3.5 Migration — `order_status_enum.sql`

**⚠️ Highest-risk migration in this runbook. Preconditions:**

1. 3.4 applied and verified on prod.
2. `pg_dump public.orders > orders_pre_enum.sql` taken immediately before.
3. Pre-check returns 0 rows:

```sql
select distinct status
from public.orders
where status not in (
  'pending_payment','paid','preparing','ready_for_pickup',
  'picked_up','delivered','cancelled'
);
```

Migration:

```sql
-- Phase 3.5 — convert orders.status to enum.
-- Rollback: alter type order_status is destructive; restore from pg_dump if needed.

create type public.order_status as enum (
  'pending_payment',
  'paid',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'delivered',
  'cancelled'
);

alter table public.orders alter column status drop default;

alter table public.orders
  alter column status type public.order_status
  using status::public.order_status;

alter table public.orders
  alter column status set default 'pending_payment',
  alter column status set not null;
```

If the `USING` fails, a non-canonical value slipped through. Roll back, fix the mapping, retry.

### 3.6 Migration — `order_transition_trigger.sql`

```sql
-- Phase 3.6 — enforce legal transitions.
-- Rollback: drop trigger orders_enforce_transition; drop function public.enforce_order_transition();

create or replace function public.enforce_order_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;   -- service_role / webhook
  if public.has_role('admin') then return new; end if;
  if new.status = old.status then return new; end if;

  if not (
    (old.status = 'pending_payment' and new.status in ('paid','cancelled'))
    or (old.status = 'paid'              and new.status in ('preparing','cancelled'))
    or (old.status = 'preparing'         and new.status in ('ready_for_pickup','cancelled'))
    or (old.status = 'ready_for_pickup'  and new.status in ('picked_up','cancelled'))
    or (old.status = 'picked_up'         and new.status in ('delivered','cancelled'))
  ) then
    raise exception 'invalid order transition: % -> %', old.status, new.status
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enforce_transition on public.orders;

create trigger orders_enforce_transition
  before update on public.orders
  for each row
  execute function public.enforce_order_transition();
```

**Note on role mapping:** this trigger enforces *legality*, not *who*. A customer could still try `pending_payment → cancelled` on someone else's order, but Phase 1's RLS already prevents them from reaching that row. Role-to-transition enforcement is a future hardening; do not add it here.

### 3.7 Migration — `cash_auto_paid_fix.sql`

Read the current cash-auto-paid trigger from `supabase/migrations/`. Its condition currently checks for one specific spelling of "Delivered". Now that 3.5 canonicalised `orders.status`, update the condition to:

```sql
-- Phase 3.7 — fix cash-auto-paid to match canonical status.
-- Read the current trigger definition from `supabase/migrations/` and replace
-- the status check. The exact CREATE OR REPLACE depends on the existing
-- function name and body — do not invent it. If the existing function is
-- named e.g. `public.handle_cash_delivery`, preserve that name so dependent
-- grants and references stay valid.

create or replace function public.handle_cash_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered'
     and new.payment_method = 'cash'
     and new.payment_status is distinct from 'paid'
  then
    new.payment_status := 'paid';
  end if;
  return new;
end;
$$;
```

Verify the function name and column names in the existing migration. If they differ, adapt — the semantic change is only the string equality.

### 3.8 PR — Frontend cleanup + type regen

1. Run:
   ```
   npx supabase gen types typescript --local > src/integrations/supabase/types.ts
   ```
2. Run `tsc --noEmit`. Every error touching `order.status` is a callsite to fix. The generated union replaces raw strings everywhere.
3. Delete `src/lib/order-status.ts` — `normaliseStatus` is dead after 3.4 + 3.8.
4. Run typecheck + tests. Iterate until green.

### 3.9 Test matrix (staging, mandatory before prod)

Full lifecycle on a fresh test order:

| Step | Expected |
|---|---|
| `pending_payment → paid` | succeeds |
| `paid → preparing` | succeeds |
| `preparing → ready_for_pickup` | succeeds |
| `ready_for_pickup → picked_up` | succeeds |
| `picked_up → delivered` | succeeds |
| `paid → delivered` (skip states) | raises `invalid order transition` |
| `delivered → preparing` (backwards) | raises |
| `cancelled → any` | raises |
| cash order reaches `delivered` | `payment_status` becomes `paid` automatically |

### 3.10 Deploy order

Strictly sequential:

1. 3.3 frontend PR → deploy → **wait 24h**
2. 3.4 backfill migration → apply to prod
3. 3.5 enum migration → apply to prod (with pre-dump)
4. 3.6 transition trigger → apply to prod
5. 3.7 cash fix → apply to prod
6. 3.8 frontend cleanup → deploy

Steps 3.4–3.7 can be bundled into a single deploy window but must be applied in the listed order.

### 3.11 Rollback

- 3.3: revert frontend, still safe (reads work with normalise).
- 3.4: restore from `orders_pre_enum.sql` dump if needed. Downstream consumers were already writing canonical so the backfill should be a no-op for new rows.
- 3.5: dropping the enum requires recreating the text column. Do not do this casually — restore from dump.
- 3.6: drop trigger, statuses become free again.
- 3.7: revert to previous cash trigger.

---

## Phase 4 — Money representation

**Goal:** All money columns are integer cents, not `NUMERIC(10,2)`.

**Path depends on order volume:**

| Situation | Path |
|---|---|
| Already `*_cents integer` | Skip this phase. |
| NUMERIC, < 100 real orders, not yet public | One-shot migration — swap type in a single transaction. |
| NUMERIC, live with real customers | Expand/contract (below), ~2 weeks. |

### 4.1 Audit

```sql
select column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_name = 'orders'
  and column_name in ('total','subtotal','delivery_fee','service_fee','tip');
```

### 4.2 Decision

Operator decides based on volume + public status.

### 4.3 Expand/contract (live case)

**Migration 01 — `money_cents_01_add_columns.sql`**

```sql
-- Phase 4.3 step 1 — add nullable cents columns and backfill.

alter table public.orders
  add column if not exists total_cents        integer,
  add column if not exists subtotal_cents     integer,
  add column if not exists delivery_fee_cents integer,
  add column if not exists service_fee_cents  integer,
  add column if not exists tip_cents          integer;

update public.orders
  set total_cents        = round(total * 100)::int,
      subtotal_cents     = round(subtotal * 100)::int,
      delivery_fee_cents = round(delivery_fee * 100)::int,
      service_fee_cents  = round(service_fee * 100)::int,
      tip_cents          = round(tip * 100)::int
  where total_cents is null;   -- idempotent re-run safety
```

**Migration 02 — `money_cents_02_not_null.sql`**

```sql
alter table public.orders
  alter column total_cents        set not null,
  alter column subtotal_cents     set not null,
  alter column delivery_fee_cents set not null,
  alter column service_fee_cents  set not null,
  alter column tip_cents          set not null;

alter table public.orders
  add constraint orders_total_cents_nonneg        check (total_cents >= 0),
  add constraint orders_subtotal_cents_nonneg     check (subtotal_cents >= 0),
  add constraint orders_delivery_fee_cents_nonneg check (delivery_fee_cents >= 0),
  add constraint orders_service_fee_cents_nonneg  check (service_fee_cents >= 0),
  add constraint orders_tip_cents_nonneg          check (tip_cents >= 0);

-- Sync trigger: if old code writes NUMERIC columns, mirror to cents.
create or replace function public.sync_order_money_to_cents()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.total is distinct from old.total then
    new.total_cents := round(new.total * 100)::int;
  end if;
  if new.subtotal is distinct from old.subtotal then
    new.subtotal_cents := round(new.subtotal * 100)::int;
  end if;
  -- ...etc for the other three
  return new;
end;
$$;

drop trigger if exists orders_sync_money on public.orders;
create trigger orders_sync_money
  before update on public.orders
  for each row
  execute function public.sync_order_money_to_cents();
```

**Frontend PR — reads switch**

All reads move to `*_cents`. `src/lib/money.ts`:

```ts
export const toCents   = (rands: number) => Math.round(rands * 100);
export const fromCents = (cents: number) => cents / 100;
export const formatZAR = (cents: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })
    .format(cents / 100);
```

Every display routes through `formatZAR`. Nothing outside this file divides by 100.

**Migration 03 — `money_cents_03_drop_legacy.sql`** (apply only after frontend PR is fully deployed for 1 week)

```sql
drop trigger orders_sync_money on public.orders;
drop function public.sync_order_money_to_cents();

alter table public.orders
  drop column total,
  drop column subtotal,
  drop column delivery_fee,
  drop column service_fee,
  drop column tip;
```

### 4.4 One-shot path (pre-launch)

If < 100 real orders and no public traffic, do it in one migration:

```sql
alter table public.orders
  alter column total          type integer using round(total * 100)::int,
  alter column subtotal       type integer using round(subtotal * 100)::int,
  alter column delivery_fee   type integer using round(delivery_fee * 100)::int,
  alter column service_fee    type integer using round(service_fee * 100)::int,
  alter column tip            type integer using round(tip * 100)::int;

alter table public.orders
  rename column total          to total_cents;
  -- ...etc for the other four
```

Frontend ships in the same PR. No `_cents` and NUMERIC coexist.

---

## Phase 5 — Payments hardening

**Goal:** Verify the payment webhook is signature-verified and idempotent.

**Only apply if the audit finds gaps.** Do not pre-emptively refactor a working webhook.

### 5.1 Audit findings (produced by agent, reviewed by operator)

- Signature verification: does the handler verify the provider's signature over the RAW body (before `JSON.parse`)?
- Idempotency: is there a `(provider, provider_reference)` unique constraint, or a `webhook_events` table keyed on `(provider, event_id)`?
- Column writes: what does the handler write to `orders` and `payments`?

### 5.2 Idempotency table (if missing)

```sql
create table if not exists private.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  event_id        text not null,
  event_type      text not null,
  payload         jsonb not null,
  signature_valid boolean not null default false,
  processed_at    timestamptz,
  error           text,
  received_at     timestamptz not null default now(),
  unique (provider, event_id)
);

revoke all on private.webhook_events from anon, authenticated;
```

Handler pattern:

1. Verify signature over raw body. Reject with 400 on mismatch.
2. `insert into private.webhook_events (provider, event_id, event_type, payload, signature_valid) values (...) on conflict (provider, event_id) do nothing;`
3. If 0 rows inserted → replay → return 200.
4. Otherwise process, update `processed_at`.

### 5.3 Signature verification (if missing or wrong)

Must use the raw body. `await req.text()` (Next.js) or the equivalent in Deno. Never `req.json()` before verification.

### 5.4 Payment status writes

Only `service_role` should be able to flip `payment_status`. Phase 1's trigger enforces this for authenticated users; verify Edge Functions are the only other writer via grep.

---

## Phase 6 — Ongoing hygiene

### 6.1 CI green

The `supabase-ci.yml` workflow added in Phase 0 gates every migration PR.

### 6.2 RLS test suite

Location: `tests/rls/`. See [Appendix A](#appendix-a--rls-test-matrix) for the matrix. One file per role. Uses a fresh local Supabase running via `supabase start`. Runs in CI after `supabase db reset`.

### 6.3 Alerts

- Forward Supabase logs to your monitoring provider.
- Alert on spikes in `permission denied` (new RLS bug or compromised key).
- Alert on failed migrations.

### 6.4 Backups

- Enable PITR on paid plan.
- Restore to staging quarterly to prove it works — an untested backup is not a backup.

### 6.5 Migration discipline

- Every schema change is a new timestamped migration.
- Never edit a historical migration.
- Never merge a migration that hasn't passed `supabase db reset` on CI.
- Two reviewers on any migration touching RLS or `security definer`.

---

## Appendix A — RLS test matrix

Assert one positive AND one negative per cell. Positive = allowed. Negative = denied.

| | restaurants | menu_items | orders | order_items | profiles | user_roles |
|---|---|---|---|---|---|---|
| **anon** | read only | read available | ✗ all | ✗ all | ✗ all | ✗ all |
| **user** | read | read | own rows (r) | own order's (r) | self (r/u) | self (r) |
| **restaurant_owner** | own (r/u) | own (r/u) | own restaurant's (r) | own restaurant's (r) | self (r/u) | self (r) |
| **deliverer** | read | read | assigned (r/u, no money cols) | assigned order's (r) | self (r/u) | self (r) |
| **admin** | r/w | r/w | r/w | r/w | r/w | r/w |

Every cell is a positive assertion. Every column is a test file. Every row is a user fixture.

---

## Appendix B — Rollback plans

| Phase | Rollback |
|---|---|
| 0 | Revert docs/CI branch. No prod impact. |
| 1 | Drop trigger, restore loose policy. `deliverer_id` column stays. |
| 2 | Drop added indexes/constraints. Non-breaking. |
| 3 | 3.3 revert frontend. 3.4 restore from dump. 3.5 restore from dump. 3.6/3.7 drop trigger / revert to prior definitions. |
| 4 | Ignore `*_cents`, keep NUMERIC. Additive path only. One-shot path requires dump restore. |
| 5 | Drop `private.webhook_events`. Webhook reverts to non-idempotent. |
| 6 | Remove CI step. Remove alerts. |

---

## Appendix C — Agent prompt template

Every prompt to the coding agent must include:

1. **GUARDRAILS block** (copy-paste, do not abbreviate):
   ```
   - Do NOT run `supabase db push`, `supabase link`, or any command that connects to a hosted Supabase project.
   - Do NOT run `supabase db reset` unless a local Supabase instance is the target.
   - If you need production data, STOP and ask me to run the query in the Supabase SQL editor and paste the result.
   - One commit per logical change. Commit messages reference the runbook phase.
   - Do NOT modify docs/HARDENING_RUNBOOK.md.
   - If any test fails or you're not sure, STOP and report. Do not guess.
   ```
2. Phase number and one-line goal.
3. Exact migration SQL from this runbook.
4. Frontend / Edge Function files to touch.
5. Test matrix rows for that phase.
6. Deploy order and rollback plan.
7. **Ends with `Stop and wait for my next prompt.`**

Do not batch phases into one prompt. The agent will complete the phase and stop.

---

## Appendix D — Frozen canonical values

Once Phase 3.5 lands, these values are frozen. Adding a value is a migration; removing is expensive. Do not speculate about future values.

**`order_status` (seven values):**
`pending_payment`, `paid`, `preparing`, `ready_for_pickup`, `picked_up`, `delivered`, `cancelled`

**Deliberately excluded:**
`accepted`, `on_the_way`, `refunded`, `failed` — each has a reason documented in Phase 3.

**Future consideration (do not implement now):**
- Payment-specific statuses go on a separate `payment_status` column.
- Delivery-specific statuses go on a separate `deliveries` table if Roma ever models deliveries as a first-class entity.
