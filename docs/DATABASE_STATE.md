# Database state

Lightweight replacement for the original reconstruction report. The original narrative findings are captured in docs/HARDENING_RUNBOOK.md §Context. This document covers only what the runbook operationally references.

## Summary

Every number below is derived from the 14 migration files in `supabase/migrations/` (`20260307083444` through `20260905150553`) applied in timestamp order. They describe the state the migration chain produces; the live project may differ — §9 is the reconciliation checklist (runbook Phase 0.2).

**Tables in schema public: 6**

`orders`, `order_items`, `profiles`, `restaurants`, `menu_items`, `user_roles`. No `DROP TABLE` appears anywhere in the chain.

**Columns in `orders`: 19**

13 from the initial create (`20260307083444`: `id`, `customer_name`, `phone_number`, `delivery_address`, `special_instructions`, `restaurant_id`, `restaurant_name`, `subtotal`, `delivery_fee`, `total`, `status`, `created_at`, `updated_at`), + `user_id` (`20260307211334`), + `deliverer_id` (`20260308103902`), + `payment_method`, `payment_status`, `payment_reference`, `paid_at` (`20260902115214`). No column drops.

**RLS policies across public: 28 total — on `orders`: 7**

| Table | Policies |
|---|---|
| `orders` | 7 |
| `order_items` | 4 |
| `profiles` | 3 |
| `restaurants` | 5 |
| `menu_items` | 7 |
| `user_roles` | 2 |
| **Total (schema public)** | **28** |

The 7 final `orders` policies, by name as derived from the chain:

- SELECT: `"Users can view own orders"`, `"Admins can view all orders"`, `"Deliverers can view orders"`, `"Owners can view their restaurant orders"`
- UPDATE: `"Admins can update orders"`, `"Deliverers can update orders"`, `"Owners can update their restaurant orders"`
- INSERT: none — the last INSERT policy on `orders` was dropped in `20260905143434` (consistent with order creation running through the `create-order` Edge Function as `service_role`, per runbook §Context)
- DELETE: none — never defined

A further 4 policies exist on `storage.objects` (schema `storage`, not counted in the public total): `"Anyone can view restaurant images"` (SELECT) and `"Staff can upload/update/delete restaurant images"` (INSERT/UPDATE/DELETE, added in `20260905142709`).

**Functions in schema public: 5**

- `public.update_updated_at_column()` — security invoker (`20260307083444`)
- `public.handle_new_user()` — security definer (`20260307211334`)
- `public.has_role(uuid, app_role)` — security definer (`20260308103902`, replaced with the same security setting in `20260905150532`)
- `public.owns_restaurant(uuid, integer)` — security definer at creation (`20260712221402`), replaced to security invoker in `20260905150553`
- `public.mark_cash_paid_on_delivery()` — security invoker (`20260902115214`)

No `DROP FUNCTION` appears in the chain.

**Triggers in public: 5** (on tables in schema public)

- `update_orders_updated_at` — BEFORE UPDATE on `orders` (`20260307083444`)
- `trg_mark_cash_paid` — BEFORE UPDATE on `orders` (`20260902115214`)
- `update_profiles_updated_at` — BEFORE UPDATE on `profiles` (`20260307211334`)
- `update_restaurants_updated_at` — BEFORE UPDATE on `restaurants` (`20260307214735`)
- `update_menu_items_updated_at` — BEFORE UPDATE on `menu_items` (`20260307214735`)

One additional trigger lives outside schema public and is not counted: `on_auth_user_created` — AFTER INSERT on `auth.users`, executing `public.handle_new_user()` (`20260307211334`).

**Storage buckets: 1**

`restaurant-images` (public = true), inserted in `20260308103042`. No other bucket inserts or deletes appear in the chain.

**`app_role` enum members: 4**

`admin`, `deliverer`, `user` (type created in `20260308103902`) + `restaurant_owner` (added in `20260712221402` via `ADD VALUE IF NOT EXISTS`).

## §9 — Verification queries

Run each query in the Supabase SQL editor against the LIVE project and paste the results back (runbook Phase 0.2). "Clean" means the result matches the migration-derived state in §Summary; any deviation is drift and is triaged per runbook Phase 0.3. Introspection below uses `information_schema` / `pg_catalog` only.

1. ```sql
   -- Lists every table in schema public; clean = exactly the six tables derived in §Summary, any extra or missing name is drift.
   select table_name
   from information_schema.tables
   where table_schema = 'public'
   order by table_name;
   ```

2. ```sql
   -- Lists every column of public.orders with type and nullability; clean = 19 rows matching the §Summary derivation.
   select column_name, data_type, is_nullable
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'orders'
   order by ordinal_position;
   ```

3. ```sql
   -- Snapshots the live orders.status vocabulary with row counts (input for runbook Phase 3.1); clean = every spelling maps to a canonical value in runbook Appendix D, any unmapped spelling must be resolved before Phase 3.4.
   select status, count(*) as n
   from public.orders
   group by status
   order by n desc;
   ```

4. ```sql
   -- Counts orders whose restaurant_id points at no restaurants row (the chain defines no FK on orders.restaurant_id); clean = 0, which runbook Phase 2.1 requires before adding the FK.
   select count(*) as dangling_restaurant_id
   from public.orders o
   where o.restaurant_id is not null
     and not exists (
       select 1 from public.restaurants r
       where r.id = o.restaurant_id
     );
   ```

5. ```sql
   -- Counts orders with negative values in the migration-derived money columns (total, subtotal, delivery_fee); clean = 0.
   select count(*) as negative_money_rows
   from public.orders
   where total < 0
      or subtotal < 0
      or delivery_fee < 0;
   ```

6. ```sql
   -- Counts order_items rows with non-positive quantity; clean = 0.
   select count(*) as nonpositive_quantity_rows
   from public.order_items
   where quantity <= 0;
   ```

7. ```sql
   -- Shows the exact names and definitions of every UPDATE policy on orders; clean = the three names derived in §Summary, and runbook Phase 1.3 must use the live names reported here.
   select policyname, cmd, roles, qual, with_check
   from pg_policies
   where schemaname = 'public'
     and tablename = 'orders'
     and cmd = 'UPDATE'
   order by policyname;
   ```

8. ```sql
   -- Counts RLS policies per public table; clean = the per-table counts from §Summary (28 total, 7 on orders).
   select tablename, count(*) as policies
   from pg_policies
   where schemaname = 'public'
   group by tablename
   order by tablename;
   ```

9. ```sql
   -- Checks whether orders.deliverer_id exists; clean = one row (uuid), added by migration 20260308103902 — zero rows means that migration never reached prod (drift).
   select column_name, data_type, is_nullable
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'orders'
     and column_name = 'deliverer_id';
   ```

10. ```sql
    -- Checks whether the public.order_status enum exists; clean = zero rows (orders.status is TEXT until runbook Phase 3.5), any rows mean the enum conversion was already applied in prod.
    select t.typname, e.enumlabel
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'order_status'
    order by e.enumsortorder;
    ```

11. ```sql
    -- Lists every index on orders, order_items and menu_items; clean = only the primary-key indexes derived from migrations (orders_pkey, order_items_pkey, menu_items_pkey), anything else is a prod-only addition.
    select tablename, indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename in ('orders', 'order_items', 'menu_items')
    order by tablename, indexname;
    ```

12. ```sql
    -- Lists every function in schema public with its security setting; clean = the five functions from §Summary, with prosecdef = true only for handle_new_user and has_role.
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as security_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname;
    ```

13. ```sql
    -- Lists every user-defined trigger on public tables; clean = the five triggers from §Summary (on_auth_user_created sits on auth.users and will not appear here).
    select c.relname as table_name,
           t.tgname,
           pg_get_triggerdef(t.oid) as definition
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
    order by c.relname, t.tgname;
    ```

14. ```sql
    -- Lists the members of the public.app_role enum; clean = exactly four labels in creation order: admin, deliverer, user, restaurant_owner.
    select e.enumlabel
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
    order by e.enumsortorder;
    ```
