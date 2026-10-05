-- ============================================================================
-- ROMA Dispatch Core
-- 2026-10-05
--
-- Closes G1 (no dispatch model) and G2 (unconstrained order status) from
-- docs/ROMA-ARCHITECTURE-AUDIT.md.
--
-- SAFETY: this migration is ordered so that no constraint is applied before the
-- data satisfies it. Section 1 MUST be verified on production before Section 2
-- runs. See docs/DISPATCH-MIGRATION-RUNBOOK.md.
--
-- Three defects found by executing this against real PostgreSQL 18 (see
-- supabase/tests/dispatch.test.mjs) rather than reading it:
--   D1  orders.status DEFAULT 'New' would violate the new CHECK on every insert
--       that omits status -> order creation breaks. Fixed in sec. 2.
--   D2  trg_mark_cash_paid matched NEW.status = 'Delivered' (TitleCase). Renaming
--       the vocabulary without updating it would SILENTLY stop settling cash
--       orders. Fixed in sec. 3.
--   D3  list_open_jobs referenced r.suburb / o.delivery_suburb /
--       o.delivery_fee_cents, none of which exist. Created in sec. 4.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — ENUMERATE BEFORE YOU CONSTRAIN
-- ============================================================================
-- Run this first, in production, and confirm every value maps below.
--
--   SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY 2 DESC;
--
-- Canonical mapping (the live vocabulary observed in this repo is TitleCase,
-- and INCONSISTENTLY spaced — note 'Picked Up'):
--
--   'New'        -> 'pending'
--   'Accepted'   -> 'accepted'
--   'Preparing'  -> 'preparing'
--   'Ready'      -> 'ready'
--   'Picked Up'  -> 'picked_up'
--   'Delivered'  -> 'delivered'
--   'Cancelled'  -> 'cancelled'
--   'Failed'     -> 'failed'
--
-- Any value NOT in the left column must be reconciled by hand before Section 2.
-- Section 2 aborts if unmapped values remain, rather than guessing.


-- ============================================================================
-- SECTION 2 — STATUS VOCABULARY, DEFAULT, AND CHECK CONSTRAINT
-- ============================================================================

-- 2a. Backfill TitleCase -> canonical lowercase. Idempotent.
UPDATE public.orders SET status = CASE status
  WHEN 'New'       THEN 'pending'
  WHEN 'Accepted'  THEN 'accepted'
  WHEN 'Preparing' THEN 'preparing'
  WHEN 'Ready'     THEN 'ready'
  WHEN 'Picked Up' THEN 'picked_up'
  WHEN 'Delivered' THEN 'delivered'
  WHEN 'Cancelled' THEN 'cancelled'
  WHEN 'Failed'    THEN 'failed'
  ELSE status
END
WHERE status IN ('New','Accepted','Preparing','Ready','Picked Up','Delivered','Cancelled','Failed');

-- 2b. D1 — the default must match the new vocabulary, or every INSERT that omits
--     status fails the CHECK constraint below and order placement breaks.
ALTER TABLE public.orders ALTER COLUMN status SET DEFAULT 'pending';

-- 2c. Guard: fail loudly on any value the backfill did not map, instead of
--     letting ADD CONSTRAINT throw an opaque error.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(DISTINCT status, ', ') INTO v_bad
    FROM public.orders
   WHERE status NOT IN ('pending','accepted','preparing','ready',
                        'assigned','picked_up','delivered','cancelled','failed');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Unmapped order status value(s) present: %. Reconcile these manually before adding the constraint.',
      v_bad
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'pending','accepted','preparing','ready',
    'assigned','picked_up','delivered','cancelled','failed'
  ));

-- 2d. Lifecycle timestamps.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;


-- ============================================================================
-- SECTION 3 — D2: CASH-PAID TRIGGER MUST FOLLOW THE NEW VOCABULARY
-- ============================================================================
-- The pre-existing trigger matched 'Delivered'. Left unchanged it would never
-- fire again, and cash orders would silently remain payment_status='pending'
-- forever. This is a money bug, not a cosmetic one.
CREATE OR REPLACE FUNCTION public.mark_cash_paid_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND NEW.payment_method = 'cash'
     AND NEW.payment_status IS DISTINCT FROM 'paid' THEN
    NEW.payment_status := 'paid';
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_cash_paid ON public.orders;
CREATE TRIGGER trg_mark_cash_paid
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.mark_cash_paid_on_delivery();


-- ============================================================================
-- SECTION 4 — D3: COLUMNS REQUIRED BY THE JOB BOARD (G4 groundwork)
-- ============================================================================

-- 4a. Suburb-level geography. Street address stays private until assignment.
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS suburb text;
ALTER TABLE public.orders      ADD COLUMN IF NOT EXISTS delivery_suburb text;

-- 4a-ii. Service zone (G4). Kept as text for now; the geofenced polygon model
--        with lat/lng arrives in the dedicated geo slice. A zone label is enough
--        for dispatch to sort a board and for the UI to group jobs.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_zone text;

-- 4b. Money in integer cents.
--     Reconciliation note: the existing `delivery_fee NUMERIC(10,2)` is retained
--     for backward compatibility because create-order and the client both still
--     write it. `delivery_fee_cents` is the CANONICAL value going forward.
--     Removing the numeric duplicate is a follow-up slice (see audit §7 pricing.ts),
--     not something to do inside a dispatch migration.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee_cents integer;
UPDATE public.orders
   SET delivery_fee_cents = COALESCE(delivery_fee_cents, ROUND(delivery_fee * 100)::integer)
 WHERE delivery_fee_cents IS NULL;
ALTER TABLE public.orders ALTER COLUMN delivery_fee_cents SET DEFAULT 1500;
ALTER TABLE public.orders ALTER COLUMN delivery_fee_cents SET NOT NULL;

CREATE INDEX IF NOT EXISTS orders_open_jobs_idx
  ON public.orders (status, created_at)
  WHERE status = 'ready' AND deliverer_id IS NULL;

CREATE INDEX IF NOT EXISTS orders_deliverer_idx
  ON public.orders (deliverer_id, status)
  WHERE deliverer_id IS NOT NULL;


-- ============================================================================
-- SECTION 5 — TRANSITIONS AS DATA, NOT SCATTERED CONDITIONALS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_status_transitions (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  actor       text NOT NULL CHECK (actor IN ('customer','vendor','deliverer','system')),
  PRIMARY KEY (from_status, to_status, actor)
);

INSERT INTO public.order_status_transitions (from_status, to_status, actor) VALUES
  ('pending','accepted','vendor'),
  ('pending','cancelled','customer'),   ('pending','cancelled','system'),

  -- DECISION: admin accounts act as actor='system' (see current_actor() in
  -- section 6). The existing AdminDashboard performs the vendor-side steps
  -- (Accept / Ready) directly, so without these three rows that dashboard would
  -- break the moment the state machine became binding. Adding explicit system
  -- rows keeps that capability while leaving the transitions table as the single
  -- authority. FLAGGED FOR REVIEW: this is a deliberate grant of vendor powers
  -- to admins, not an accident. If admin should NOT be able to accept orders on
  -- a vendor's behalf, delete these three rows and remove the corresponding
  -- buttons from AdminDashboard.
  ('pending','accepted','system'),
  ('accepted','preparing','system'),
  ('preparing','ready','system'),

  ('accepted','preparing','vendor'),
  ('accepted','cancelled','vendor'),    ('accepted','cancelled','customer'),

  ('preparing','ready','vendor'),
  ('preparing','cancelled','vendor'),

  ('ready','assigned','deliverer'),
  ('ready','cancelled','vendor'),       ('ready','cancelled','system'),

  ('assigned','picked_up','deliverer'),
  ('assigned','ready','deliverer'),     -- release back to the board
  ('assigned','failed','deliverer'),    ('assigned','failed','system'),

  ('picked_up','delivered','deliverer'),
  ('picked_up','failed','deliverer'),   ('picked_up','failed','system')
ON CONFLICT DO NOTHING;

ALTER TABLE public.order_status_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Transitions are readable by all" ON public.order_status_transitions;
CREATE POLICY "Transitions are readable by all"
  ON public.order_status_transitions FOR SELECT
  TO anon, authenticated USING (true);


-- ============================================================================
-- SECTION 6 — ACTOR RESOLUTION
-- ============================================================================
-- Maps the caller's JWT identity to one transition actor. Precedence is explicit
-- and deterministic rather than relying on role-query ordering.
CREATE OR REPLACE FUNCTION public.current_actor()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN public.has_role(auth.uid(), 'admin')            THEN 'system'
    WHEN public.has_role(auth.uid(), 'deliverer')        THEN 'deliverer'
    WHEN public.has_role(auth.uid(), 'restaurant_owner') THEN 'vendor'
    ELSE 'customer'
  END
$$;

REVOKE ALL ON FUNCTION public.current_actor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_actor() TO authenticated, service_role;


-- ============================================================================
-- SECTION 7 — SERVICE WINDOW (08:00-16:00, Mon-Fri, SAST)
-- ============================================================================
-- South Africa observes no DST, so a fixed offset is safe, but we still resolve
-- via the named zone so the rule survives any future tzdata change.
CREATE OR REPLACE FUNCTION public.is_within_service_window()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Johannesburg')) BETWEEN 1 AND 5
     AND (now() AT TIME ZONE 'Africa/Johannesburg')::time
         BETWEEN time '08:00' AND time '16:00';
$$;

REVOKE ALL ON FUNCTION public.is_within_service_window() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_within_service_window() TO anon, authenticated, service_role;


-- ============================================================================
-- SECTION 8 — ATOMIC CLAIM
-- ============================================================================
-- Returns jsonb rather than a composite: composite returns are ambiguous over
-- the PostgREST/supabase-js wire and awkward to type in TypeScript.
CREATE OR REPLACE FUNCTION public.claim_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_role(auth.uid(), 'deliverer') THEN
    RAISE EXCEPTION 'not_a_deliverer' USING ERRCODE = '42501';
  END IF;

  -- Enforced server-side. A window rendered only in the UI is not a window.
  IF NOT public.is_within_service_window() THEN
    RAISE EXCEPTION 'outside_service_window' USING ERRCODE = 'P0001';
  END IF;

  -- SKIP LOCKED is the whole point: two drivers tapping simultaneously means one
  -- wins and the other gets order_unavailable, never a shared delivery.
  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     AND status = 'ready'
     AND deliverer_id IS NULL
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_unavailable' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.orders
     SET deliverer_id = auth.uid(),
         status       = 'assigned',
         assigned_at  = now()
   WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN to_jsonb(v_order);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_order(uuid) TO authenticated, service_role;


-- ============================================================================
-- SECTION 9 — GUARDED STATUS TRANSITION
-- ============================================================================
-- All status changes route through here so the transitions table is the single
-- authority. A driver cannot jump assigned -> delivered.
CREATE OR REPLACE FUNCTION public.transition_order_status(p_order_id uuid, p_to text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor   text;
  v_order   public.orders;
  v_allowed boolean;
  v_pair_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_actor := public.current_actor();

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- A deliverer may only act on the order assigned to them.
  IF v_actor = 'deliverer' AND v_order.deliverer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_order' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.order_status_transitions
     WHERE from_status = v_order.status AND to_status = p_to AND actor = v_actor
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    -- Distinguish "nobody may do this" from "you personally may not", because
    -- the client renders these differently and conflating them makes debugging
    -- a production incident much harder.
    SELECT EXISTS (
      SELECT 1 FROM public.order_status_transitions
       WHERE from_status = v_order.status AND to_status = p_to
    ) INTO v_pair_ok;

    IF v_pair_ok THEN
      RAISE EXCEPTION 'actor_not_permitted' USING ERRCODE = '42501';
    ELSE
      RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.orders
     SET status = p_to,
         assigned_at  = CASE WHEN p_to = 'assigned'  THEN now() ELSE assigned_at  END,
         picked_up_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE picked_up_at END,
         delivered_at = CASE WHEN p_to = 'delivered' THEN now() ELSE delivered_at END
   WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN to_jsonb(v_order);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text) TO authenticated, service_role;


-- ============================================================================
-- SECTION 10 — REDACTED JOB BOARD
-- ============================================================================
-- A driver sees a job before accepting it, not a customer. No name, no phone,
-- no street address. Suburb is the coarsest useful unit and is safe to expose.
CREATE OR REPLACE FUNCTION public.list_open_jobs()
RETURNS TABLE (
  id             uuid,
  restaurant_name text,
  pickup_suburb  text,
  dropoff_suburb text,
  fee_cents      integer,
  zone           text,
  created_at     timestamptz,
  age_seconds    integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.id,
         o.restaurant_name,
         COALESCE(r.suburb, 'Pretoria Central')            AS pickup_suburb,
         COALESCE(o.delivery_suburb, 'Unspecified')        AS dropoff_suburb,
         o.delivery_fee_cents                              AS fee_cents,
         COALESCE(o.delivery_zone, 'unspecified')          AS zone,
         o.created_at,
         EXTRACT(EPOCH FROM (now() - o.created_at))::integer AS age_seconds
    FROM public.orders o
    LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
   WHERE o.status = 'ready'
     AND o.deliverer_id IS NULL
     AND public.has_role(auth.uid(), 'deliverer')
   ORDER BY o.created_at
   LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.list_open_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_open_jobs() TO authenticated, service_role;


-- ============================================================================
-- SECTION 11 — CLOSE THE RLS HOLE
-- ============================================================================
-- The previous policies were:
--   USING (public.has_role(auth.uid(), 'deliverer'))
-- with no reference to deliverer_id, so every deliverer could read and mutate
-- EVERY order — full customer PII and a self-delivery fraud vector.
DROP POLICY IF EXISTS "Deliverers can view orders"   ON public.orders;
DROP POLICY IF EXISTS "Deliverers can update orders" ON public.orders;

CREATE POLICY "Deliverers view own assigned orders"
  ON public.orders FOR SELECT TO authenticated
  USING (deliverer_id = auth.uid());

-- NOTE: a deliverer cannot set deliverer_id via UPDATE — the WITH CHECK requires
-- the row to already be theirs. Assignment flows ONLY through claim_order(),
-- which is the single path that holds the row lock. This is deliberate.
CREATE POLICY "Deliverers update own assigned orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (deliverer_id = auth.uid())
  WITH CHECK (deliverer_id = auth.uid());

-- order_items followed the same unscoped pattern.
DROP POLICY IF EXISTS "Deliverers can view order items" ON public.order_items;
CREATE POLICY "Deliverers view own assigned order items"
  ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = order_items.order_id AND o.deliverer_id = auth.uid()
  ));


-- ============================================================================
-- SECTION 12 — ENFORCE THE STATE MACHINE AT THE STORAGE LAYER
-- ============================================================================
-- Section 9 guards the RPC path. But THREE call sites bypass it by updating the
-- row directly:
--     src/pages/AdminDashboard.tsx:110   .update({ status: newStatus })
--     src/pages/DelivererDashboard.tsx:125 .update({ status: newStatus })
--     src/pages/OwnerDashboard.tsx:99    .update({ status })
-- RLS permits those (owners may update their own restaurant's orders; deliverers
-- may update their assigned ones), so the CHECK constraint constrains the
-- VOCABULARY but not the ORDER of transitions. A deliverer could therefore still
-- jump assigned -> delivered with a raw UPDATE and clear a delivery they never
-- made.
--
-- A client-side guard is decoration. This trigger makes the transitions table
-- binding for every write path, whoever issues it.
-- SECURITY INVOKER IS LOAD-BEARING HERE — do not change it to DEFINER.
-- Under SECURITY DEFINER, `current_user` inside this function is always the
-- function OWNER, so the trusted-role bypass below would match on every single
-- call and the trigger would enforce nothing. This was caught by the test suite
-- (section 13b), not by reading the code. As INVOKER, current_user is the role
-- actually issuing the UPDATE: `authenticated` for a client, `postgres` for the
-- SECURITY DEFINER RPC in section 9, `service_role` for edge functions.
CREATE OR REPLACE FUNCTION public.enforce_status_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_actor   text;
  v_allowed boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Trusted server contexts: migrations, dashboard SQL, and edge functions
  -- running with the service key. RLS does not disable triggers, so BYPASSRLS
  -- alone would not exempt them — hence an explicit role check.
  -- NOTE: inside a SECURITY DEFINER function, current_user is the FUNCTION
  -- OWNER, so the RPC in section 9 is exempted here and validates internally.
  -- A raw UPDATE from a client runs as `authenticated` and is therefore subject
  -- to the check below. That asymmetry is the intended behaviour.
  IF current_user IN ('service_role','postgres','supabase_admin','supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  v_actor := public.current_actor();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.order_status_transitions
     WHERE from_status = OLD.status AND to_status = NEW.status AND actor = v_actor
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'illegal_status_transition: % -> % by %', OLD.status, NEW.status, v_actor
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_status_transition ON public.orders;
CREATE TRIGGER trg_enforce_status_transition
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_status_transition();
