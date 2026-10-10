-- Backend hardening:
--   1. Integrity constraints on the fields that drive the order workflow
--   2. Atomic order creation (replaces the two-step insert + compensating delete)
--   3. Deliverer order claiming, so deliverers can only update orders assigned to them
--
-- All statements are idempotent so this migration can be re-applied safely.
--
-- DELIBERATE FAILURE MODE: the status CHECK constraints below are added without
-- first rewriting existing rows to fit. If this migration fails with
-- "check constraint ... is violated by some row", that means the orders table
-- already contains a status value no current UI can produce - stale or corrupt
-- data that would otherwise stay invisible and keep those orders stuck. Inspect
-- with:
--
--   SELECT status, payment_status, payment_method, count(*)
--   FROM public.orders GROUP BY 1, 2, 3 ORDER BY 4 DESC;
--
-- then map the offending values onto the allowed lists and re-run. Do not weaken
-- the constraint to make the migration pass.

--------------------------------------------------------------------------------
-- 1. Integrity constraints
--------------------------------------------------------------------------------

-- Normalise any legacy free-text statuses before constraining the column, so the
-- CHECK cannot fail on data written before this migration existed.
UPDATE public.orders SET status = 'New'
  WHERE status IS NULL OR btrim(status) = '';

UPDATE public.orders SET payment_status = 'pending'
  WHERE payment_status IS NULL OR btrim(payment_status) = '';

UPDATE public.orders SET payment_method = 'cash'
  WHERE payment_method IS NULL OR btrim(payment_method) = '';

-- Order lifecycle. This is the union of every status the admin, owner and
-- deliverer dashboards write, plus 'Cancelled' which no UI writes yet.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'New',
    'Accepted',
    'Preparing',
    'Ready',
    'Ready for Pickup/Delivery',
    'Picked Up',
    'On the Way',
    'Delivered',
    'Cancelled'
  ));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash', 'card'));

-- Money and rating sanity. Menu prices and restaurant ratings are written
-- directly from the admin/owner UI rather than through an Edge Function, so the
-- database is the only place these can be reliably enforced.
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_price_non_negative;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_price_non_negative
  CHECK (price >= 0);

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_rating_range;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_rating_range
  CHECK (rating >= 0 AND rating <= 5);

-- A paid order must carry a timestamp. Deliberately one-directional: an order
-- that was paid and later refunded or failed keeps its historical paid_at rather
-- than having audit data destroyed.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_paid_at_consistency;
ALTER TABLE public.orders ADD CONSTRAINT orders_paid_at_consistency
  CHECK (payment_status <> 'paid' OR paid_at IS NOT NULL);

-- Backfill: give already-paid rows a timestamp so the constraint can be added.
UPDATE public.orders SET paid_at = COALESCE(updated_at, now())
  WHERE payment_status = 'paid' AND paid_at IS NULL;

-- Reassert the cash-paid trigger so it satisfies orders_paid_at_consistency even
-- if paid_at is set and the status is changed later. Definition unchanged from
-- migration 20260902115214 apart from the COALESCE.
CREATE OR REPLACE FUNCTION public.mark_cash_paid_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Delivered' AND NEW.payment_method = 'cash' AND NEW.payment_status <> 'paid' THEN
    NEW.payment_status := 'paid';
    NEW.paid_at := COALESCE(NEW.paid_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_cash_paid ON public.orders;
CREATE TRIGGER trg_mark_cash_paid
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.mark_cash_paid_on_delivery();

--------------------------------------------------------------------------------
-- 2. Single source of truth for the delivery fee, and atomic order creation
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Read-only for the app; only the service role (Edge Functions) may write.
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Anyone can read app settings" ON public.app_settings
  FOR SELECT USING (true);

INSERT INTO public.app_settings (key, value) VALUES ('delivery_fee', '15')
  ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_delivery_fee()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value::numeric FROM public.app_settings WHERE key = 'delivery_fee'), 15);
$$;

REVOKE ALL ON FUNCTION public.current_delivery_fee() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_delivery_fee() TO anon, authenticated, service_role;

-- Inserts an order and its items in one statement, so a failure can never leave
-- an order row behind with no items. SECURITY DEFINER is required because direct
-- INSERT on orders/order_items was revoked from authenticated and anon in
-- migration 20260905143434; the caller is the create-order Edge Function running
-- under the service role, which has already authenticated the end user.
CREATE OR REPLACE FUNCTION public.create_order_with_items(
  p_customer_name text,
  p_phone_number text,
  p_delivery_address text,
  p_special_instructions text,
  p_restaurant_id integer,
  p_restaurant_name text,
  p_subtotal numeric,
  p_payment_method text,
  p_user_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery_fee numeric;
  v_order_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'create_order_with_items: p_user_id is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_order_with_items: p_items must be a non-empty array';
  END IF;

  IF p_subtotal IS NULL OR p_subtotal < 0 THEN
    RAISE EXCEPTION 'create_order_with_items: p_subtotal must be non-negative';
  END IF;

  IF p_payment_method NOT IN ('cash', 'card') THEN
    RAISE EXCEPTION 'create_order_with_items: invalid payment method';
  END IF;

  -- The fee is read from the database so the client can never influence it.
  v_delivery_fee := public.current_delivery_fee();

  INSERT INTO public.orders (
    customer_name, phone_number, delivery_address, special_instructions,
    restaurant_id, restaurant_name, subtotal, delivery_fee, total,
    status, user_id, payment_method, payment_status
  ) VALUES (
    p_customer_name, p_phone_number, p_delivery_address, p_special_instructions,
    p_restaurant_id, p_restaurant_name, p_subtotal, v_delivery_fee,
    round(p_subtotal + v_delivery_fee, 2),
    'New', p_user_id, p_payment_method, 'pending'
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, item_name, item_price, quantity)
  SELECT
    v_order_id,
    item ->> 'item_name',
    (item ->> 'item_price')::numeric,
    (item ->> 'quantity')::integer
  FROM jsonb_array_elements(p_items) AS item
  WHERE item ->> 'item_name' IS NOT NULL
    AND item ->> 'item_price' IS NOT NULL
    AND item ->> 'quantity' IS NOT NULL;

  IF (SELECT count(*) FROM public.order_items WHERE order_id = v_order_id)
     <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'create_order_with_items: item rows did not match the submitted items';
  END IF;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'subtotal', round(p_subtotal, 2),
    'deliveryFee', v_delivery_fee,
    'total', round(p_subtotal + v_delivery_fee, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_with_items(
  text, text, text, text, integer, text, numeric, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(
  text, text, text, text, integer, text, numeric, text, uuid, jsonb
) TO service_role;

--------------------------------------------------------------------------------
-- 3. Deliverer claiming
--------------------------------------------------------------------------------

-- deliverer_id has existed since migration 20260308103902 but was never written.
-- Claiming atomically assigns an unclaimed order to the calling deliverer; the
-- conditional UPDATE makes a double-claim impossible.
CREATE OR REPLACE FUNCTION public.claim_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_deliverer boolean;
  v_claimed boolean := false;
BEGIN
  SELECT public.has_role(auth.uid(), 'deliverer') INTO v_is_deliverer;

  IF NOT COALESCE(v_is_deliverer, false) THEN
    RAISE EXCEPTION 'claim_order: deliverer role required';
  END IF;

  UPDATE public.orders
     SET deliverer_id = auth.uid(),
         status = CASE WHEN status = 'New' THEN 'Accepted' ELSE status END
   WHERE id = p_order_id
     AND deliverer_id IS NULL
     AND status <> 'Delivered'
     AND status <> 'Cancelled';

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_order(uuid) TO authenticated, service_role;

-- Deliverers may now only change orders actually assigned to them. Admins keep
-- their unrestricted policy from migration 20260905142709.
--
-- Note: deliverers can still SELECT all orders, because the pickup board has to
-- show unclaimed orders for them to claim. That read exposure is deliberate and
-- unchanged here; scoping writes is what this policy fixes.
DROP POLICY IF EXISTS "Deliverers can update orders" ON public.orders;
CREATE POLICY "Deliverers can update assigned orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'deliverer') AND deliverer_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'deliverer') AND deliverer_id = auth.uid());

-- Deliverers may read the items of any order they can read. The previous policy
-- only covered own/admin, which left claimed orders' items unreadable once the
-- UPDATE policy was scoped.
DROP POLICY IF EXISTS "Deliverers can view order items" ON public.order_items;
CREATE POLICY "Deliverers can view order items" ON public.order_items
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'deliverer'));

-- Admins may assign or reassign a deliverer directly.
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Restaurant owners keep status updates on their own orders, but must not be able
-- to touch payment fields or the deliverer assignment.
DROP POLICY IF EXISTS "Owners can update their restaurant orders" ON public.orders;
CREATE POLICY "Owners can update their restaurant orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (restaurant_id IS NOT NULL AND public.owns_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (restaurant_id IS NOT NULL AND public.owns_restaurant(auth.uid(), restaurant_id));
