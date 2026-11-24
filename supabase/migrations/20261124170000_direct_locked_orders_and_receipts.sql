-- Direct server-locked orders & tamper-proof receipts (24 Nov 2026)
--
-- Replaces editable client-side WhatsApp order messages with server-priced,
-- immutable orders created the moment the customer clicks Place Order:
--   1. Adds order_number (ROMA-1001+), receipt_token (128-bit UUID),
--      is_preorder, promo_code, standard_delivery_fee, and notification_status
--      to public.orders.
--   2. Extends orders_protect_money trigger so receipt metadata cannot be
--      altered after creation.
--   3. Adds public.place_storefront_order(...) (callable by guests & signed-in
--      users) to re-price items from public.menu_items, apply per-restaurant
--      delivery fees + signed-in free-delivery credits, and persist the order.
--   4. Adds public.get_order_receipt(uuid) to verify any receipt by token.

-- ---------------------------------------------------------------------------
-- 1. Sequence & receipt columns on public.orders
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.orders_number_seq
  START WITH 1001
  INCREMENT BY 1;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS receipt_token UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS is_preorder BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_code TEXT,
  ADD COLUMN IF NOT EXISTS standard_delivery_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS notification_status JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill order_number and standard_delivery_fee on any pre-existing orders.
DO $$
DECLARE
  v_order RECORD;
BEGIN
  FOR v_order IN
    SELECT id
    FROM public.orders
    WHERE order_number IS NULL OR btrim(order_number) = ''
    ORDER BY created_at, id
  LOOP
    UPDATE public.orders
    SET order_number = 'ROMA-' || nextval('public.orders_number_seq')::text
    WHERE id = v_order.id;
  END LOOP;

  UPDATE public.orders
  SET standard_delivery_fee = delivery_fee
  WHERE standard_delivery_fee IS NULL;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_key
  ON public.orders (order_number);

CREATE UNIQUE INDEX IF NOT EXISTS orders_receipt_token_key
  ON public.orders (receipt_token);

-- ---------------------------------------------------------------------------
-- 2. Harden orders_protect_money trigger to also lock receipt fields
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_order_money_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- service_role / webhook / migration context
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- admins may edit anything
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.total                 IS DISTINCT FROM OLD.total
  OR NEW.subtotal              IS DISTINCT FROM OLD.subtotal
  OR NEW.delivery_fee          IS DISTINCT FROM OLD.delivery_fee
  OR NEW.standard_delivery_fee IS DISTINCT FROM OLD.standard_delivery_fee
  OR NEW.user_id               IS DISTINCT FROM OLD.user_id
  OR NEW.restaurant_id         IS DISTINCT FROM OLD.restaurant_id
  OR NEW.payment_method        IS DISTINCT FROM OLD.payment_method
  OR NEW.payment_status        IS DISTINCT FROM OLD.payment_status
  OR NEW.payment_reference     IS DISTINCT FROM OLD.payment_reference
  OR NEW.paid_at               IS DISTINCT FROM OLD.paid_at
  OR NEW.order_number          IS DISTINCT FROM OLD.order_number
  OR NEW.receipt_token         IS DISTINCT FROM OLD.receipt_token
  OR NEW.promo_code            IS DISTINCT FROM OLD.promo_code
  OR NEW.is_preorder           IS DISTINCT FROM OLD.is_preorder
  THEN
    RAISE EXCEPTION 'cannot edit money or ownership columns'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_protect_money ON public.orders;

CREATE TRIGGER orders_protect_money
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_order_money_columns();

-- ---------------------------------------------------------------------------
-- 3. Read-only receipt lookup by unguessable receipt_token
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_order_receipt(p_receipt_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order RECORD;
  v_slug TEXT;
  v_items JSONB;
BEGIN
  IF p_receipt_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    o.id,
    o.order_number,
    o.receipt_token,
    o.customer_name,
    o.phone_number,
    o.delivery_address,
    o.special_instructions,
    o.restaurant_id,
    o.restaurant_name,
    o.subtotal,
    o.standard_delivery_fee,
    o.delivery_fee,
    o.total,
    o.status,
    o.payment_method,
    o.payment_status,
    o.promo_code,
    o.is_preorder,
    o.created_at
  INTO v_order
  FROM public.orders o
  WHERE o.receipt_token = p_receipt_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT r.slug
  INTO v_slug
  FROM public.restaurants r
  WHERE r.id = v_order.restaurant_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'name', oi.item_name,
        'price', round(oi.item_price, 2),
        'quantity', oi.quantity,
        'line_total', round(oi.item_price * oi.quantity, 2)
      )
      ORDER BY oi.created_at, oi.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', coalesce(v_order.order_number, 'ROMA-' || upper(substr(v_order.id::text, 1, 6))),
    'receipt_token', v_order.receipt_token,
    'customer_name', v_order.customer_name,
    'phone_number', v_order.phone_number,
    'delivery_address', v_order.delivery_address,
    'special_instructions', v_order.special_instructions,
    'restaurant_id', v_order.restaurant_id,
    'restaurant_name', v_order.restaurant_name,
    'restaurant_slug', v_slug,
    'subtotal', round(v_order.subtotal, 2),
    'standard_delivery_fee', round(coalesce(v_order.standard_delivery_fee, v_order.delivery_fee), 2),
    'delivery_fee', round(v_order.delivery_fee, 2),
    'total', round(v_order.total, 2),
    'status', v_order.status,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'promo_code', v_order.promo_code,
    'is_preorder', v_order.is_preorder,
    'created_at', v_order.created_at,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_receipt(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_receipt(UUID) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Authoritative storefront order placement (guest + signed-in)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_storefront_order(
  p_customer_name TEXT,
  p_phone TEXT,
  p_address TEXT,
  p_items JSONB,
  p_instructions TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_name TEXT;
  v_clean_phone TEXT;
  v_clean_address TEXT;
  v_clean_notes TEXT;
  v_elem JSONB;
  v_raw_id TEXT;
  v_raw_qty INTEGER;
  v_distinct_requested INTEGER;
  v_matched_count INTEGER;
  v_restaurant_count INTEGER;
  v_restaurant_id INTEGER;
  v_restaurant_name TEXT;
  v_restaurant_slug TEXT;
  v_restaurant_fee NUMERIC(10, 2);
  v_subtotal NUMERIC(10, 2);
  v_standard_fee NUMERIC(10, 2);
  v_applied_fee NUMERIC(10, 2);
  v_total NUMERIC(10, 2);
  v_uid UUID;
  v_promo_result JSONB;
  v_promo_code TEXT := NULL;
  v_sast_hour INTEGER;
  v_is_preorder BOOLEAN;
  v_order_number TEXT;
  v_receipt_token UUID;
  v_order_id UUID;
BEGIN
  v_clean_name := btrim(coalesce(p_customer_name, ''));
  v_clean_phone := btrim(coalesce(p_phone, ''));
  v_clean_address := btrim(coalesce(p_address, ''));
  v_clean_notes := nullif(btrim(coalesce(p_instructions, '')), '');

  IF char_length(v_clean_name) < 1 OR char_length(v_clean_name) > 120 THEN
    RAISE EXCEPTION 'Please provide your full name (1–120 characters).' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_clean_phone) < 5 OR char_length(v_clean_phone) > 30 THEN
    RAISE EXCEPTION 'Please provide a valid phone number.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_clean_address) < 5 OR char_length(v_clean_address) > 300 THEN
    RAISE EXCEPTION 'Please provide a complete delivery address.' USING ERRCODE = '22023';
  END IF;
  IF v_clean_notes IS NOT NULL AND char_length(v_clean_notes) > 500 THEN
    RAISE EXCEPTION 'Special instructions must be 500 characters or fewer.' USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Order items must be a non-empty list.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'An order must contain between 1 and 50 item entries.' USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT elem.value FROM jsonb_array_elements(p_items) AS elem
  LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'Invalid order item format.' USING ERRCODE = '22023';
    END IF;
    v_raw_id := btrim(coalesce(v_elem->>'menu_item_id', ''));
    IF v_raw_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'Invalid menu item identifier.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_elem->'quantity') <> 'number'
       OR btrim(coalesce(v_elem->>'quantity', '')) !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION 'Item quantity must be a whole number.' USING ERRCODE = '22023';
    END IF;
    v_raw_qty := (v_elem->>'quantity')::integer;
    IF v_raw_qty < 1 OR v_raw_qty > 50 THEN
      RAISE EXCEPTION 'Item quantity must be between 1 and 50.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT count(DISTINCT (elem->>'menu_item_id')::uuid)
  INTO v_distinct_requested
  FROM jsonb_array_elements(p_items) AS elem;

  SELECT
    count(*),
    count(DISTINCT m.restaurant_id),
    min(m.restaurant_id)
  INTO v_matched_count, v_restaurant_count, v_restaurant_id
  FROM public.menu_items m
  WHERE m.id IN (
    SELECT DISTINCT (elem->>'menu_item_id')::uuid
    FROM jsonb_array_elements(p_items) AS elem
  );

  IF v_matched_count <> v_distinct_requested THEN
    RAISE EXCEPTION 'Some items in your cart are no longer available.' USING ERRCODE = '22023';
  END IF;

  IF v_restaurant_count <> 1 OR v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'All items in an order must come from the same restaurant.' USING ERRCODE = '22023';
  END IF;

  SELECT r.name, r.slug, r.delivery_fee
  INTO v_restaurant_name, v_restaurant_slug, v_restaurant_fee
  FROM public.restaurants r
  WHERE r.id = v_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found.' USING ERRCODE = '22023';
  END IF;

  SELECT round(coalesce(sum(m.price * grouped.qty), 0), 2)
  INTO v_subtotal
  FROM (
    SELECT
      (elem->>'menu_item_id')::uuid AS menu_item_id,
      sum((elem->>'quantity')::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) AS elem
    GROUP BY (elem->>'menu_item_id')::uuid
  ) AS grouped
  JOIN public.menu_items m ON m.id = grouped.menu_item_id;

  v_standard_fee := round(
    coalesce(
      v_restaurant_fee,
      CASE WHEN lower(coalesce(v_restaurant_slug, '')) = 'magwinya-zone' THEN 15.00 ELSE 20.00 END
    ),
    2
  );
  v_applied_fee := v_standard_fee;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    v_promo_result := public.process_user_order_promo(
      v_uid,
      v_restaurant_slug,
      v_restaurant_name,
      v_subtotal,
      v_standard_fee,
      v_clean_name,
      v_clean_phone,
      NULL
    );

    IF coalesce((v_promo_result->>'redeemed')::boolean, false) THEN
      v_applied_fee := 0;
      v_promo_code := nullif(btrim(coalesce(v_promo_result->>'promo_code', '')), '');
    END IF;
  END IF;

  v_total := round(v_subtotal + v_applied_fee, 2);
  v_sast_hour := extract(hour FROM (now() AT TIME ZONE 'Africa/Johannesburg'))::integer;
  v_is_preorder := (v_sast_hour < 8 OR v_sast_hour >= 18);
  v_order_number := 'ROMA-' || nextval('public.orders_number_seq')::text;
  v_receipt_token := gen_random_uuid();

  INSERT INTO public.orders (
    customer_name,
    phone_number,
    delivery_address,
    special_instructions,
    restaurant_id,
    restaurant_name,
    subtotal,
    standard_delivery_fee,
    delivery_fee,
    total,
    status,
    user_id,
    payment_method,
    payment_status,
    order_number,
    receipt_token,
    is_preorder,
    promo_code
  )
  VALUES (
    v_clean_name,
    v_clean_phone,
    v_clean_address,
    v_clean_notes,
    v_restaurant_id,
    v_restaurant_name,
    v_subtotal,
    v_standard_fee,
    v_applied_fee,
    v_total,
    'New',
    v_uid,
    'eft_or_cash',
    'pending',
    v_order_number,
    v_receipt_token,
    v_is_preorder,
    v_promo_code
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id,
    item_name,
    item_price,
    quantity
  )
  SELECT
    v_order_id,
    m.name,
    round(m.price, 2),
    grouped.qty
  FROM (
    SELECT
      (elem->>'menu_item_id')::uuid AS menu_item_id,
      sum((elem->>'quantity')::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) AS elem
    GROUP BY (elem->>'menu_item_id')::uuid
  ) AS grouped
  JOIN public.menu_items m ON m.id = grouped.menu_item_id;

  IF v_promo_code IS NOT NULL THEN
    UPDATE public.delivery_credit_redemptions
    SET order_id = v_order_id
    WHERE promo_code = v_promo_code;
  END IF;

  RETURN public.get_order_receipt(v_receipt_token);
END;
$$;

REVOKE ALL ON FUNCTION public.place_storefront_order(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_storefront_order(TEXT, TEXT, TEXT, JSONB, TEXT)
  TO anon, authenticated, service_role;
