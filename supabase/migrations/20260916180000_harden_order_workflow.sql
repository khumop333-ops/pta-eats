-- Harden order access and centralize privileged order mutations.
-- Orders are created atomically by the create-order Edge Function and status/payment
-- changes go through the role-aware functions below.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS orders_user_id_idempotency_key_idx
  ON public.orders (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_deliverer_id_idx ON public.orders (deliverer_id);
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON public.orders (user_id);
CREATE INDEX IF NOT EXISTS orders_restaurant_id_idx ON public.orders (restaurant_id);

-- Keep legacy values readable while preventing new, unrecognized statuses.
UPDATE public.orders
SET status = 'Ready'
WHERE status = 'Ready for Pickup/Delivery';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'New',
    'Accepted',
    'Preparing',
    'Ready',
    'Picked Up',
    'On the Way',
    'Delivered',
    'Cancelled'
  )) NOT VALID;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_rating_check;
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_rating_check CHECK (rating >= 0 AND rating <= 5) NOT VALID;
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_price_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_price_check CHECK (price > 0) NOT VALID;

-- Deliverers must only see orders assigned to them.
DROP POLICY IF EXISTS "Deliverers can view orders" ON public.orders;
CREATE POLICY "Assigned deliverers can view orders" ON public.orders
  FOR SELECT TO authenticated
  USING (
    deliverer_id = auth.uid()
    AND public.has_role(auth.uid(), 'deliverer')
  );

DROP POLICY IF EXISTS "Deliverers can view order items" ON public.order_items;
CREATE POLICY "Assigned deliverers can view order items" ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.deliverer_id = auth.uid()
        AND public.has_role(auth.uid(), 'deliverer')
    )
  );

-- Do not expose a full-row UPDATE operation to browser clients. The functions
-- below only change the columns that each role is allowed to change.
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
DROP POLICY IF EXISTS "Deliverers can update orders" ON public.orders;
DROP POLICY IF EXISTS "Owners can update their restaurant orders" ON public.orders;
REVOKE UPDATE ON public.orders FROM anon, authenticated;

-- Admins need to see staff names in the assignment UI.
DROP POLICY IF EXISTS "Admins can view profiles" ON public.profiles;
CREATE POLICY "Admins can view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Image uploads are currently performed only by the admin restaurant manager.
-- The previous staff-wide policy allowed one restaurant owner to modify another
-- restaurant's public images.
DROP POLICY IF EXISTS "Staff can upload restaurant images" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update restaurant images" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete restaurant images" ON storage.objects;
CREATE POLICY "Admins can upload restaurant images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'restaurant-images'
    AND public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "Admins can update restaurant images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'restaurant-images'
    AND public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    bucket_id = 'restaurant-images'
    AND public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "Admins can delete restaurant images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'restaurant-images'
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE OR REPLACE FUNCTION public.create_order_atomic(
  _customer_name text,
  _phone_number text,
  _delivery_address text,
  _special_instructions text,
  _payment_method text,
  _user_id uuid,
  _idempotency_key uuid,
  _items jsonb
)
RETURNS TABLE (
  order_id uuid,
  subtotal numeric,
  delivery_fee numeric,
  total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  requested_count integer;
  found_count integer;
  restaurant_count integer;
  restaurant_id integer;
  restaurant_name text;
  item_lines jsonb;
  rounded_subtotal numeric(10, 2);
  delivery_amount numeric(10, 2) := 15.00;
  calculated_total numeric(10, 2);
  new_order_id uuid;
  existing_order public.orders%ROWTYPE;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in customer is required' USING ERRCODE = '42501';
  END IF;

  IF _payment_method NOT IN ('card', 'cash') THEN
    RAISE EXCEPTION 'Unsupported payment method' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Order items must be an array' USING ERRCODE = '22023';
  END IF;

  -- A repeated request with the same key returns the original order instead of
  -- charging or creating another order.
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO existing_order
    FROM public.orders
    WHERE user_id = _user_id
      AND idempotency_key = _idempotency_key
    FOR UPDATE;

    IF FOUND THEN
      RETURN QUERY SELECT
        existing_order.id,
        existing_order.subtotal,
        existing_order.delivery_fee,
        existing_order.total;
      RETURN;
    END IF;
  END IF;

  WITH requested AS (
    SELECT menu_item_id, SUM(quantity)::integer AS quantity
    FROM jsonb_to_recordset(_items) AS item(menu_item_id uuid, quantity integer)
    GROUP BY menu_item_id
  )
  SELECT
    COUNT(*)::integer,
    COUNT(menu_items.id)::integer,
    COUNT(DISTINCT menu_items.restaurant_id)::integer,
    MIN(menu_items.restaurant_id)
  INTO requested_count, found_count, restaurant_count, restaurant_id
  FROM requested
  LEFT JOIN public.menu_items
    ON menu_items.id = requested.menu_item_id;

  IF requested_count < 1 OR found_count <> requested_count THEN
    RAISE EXCEPTION 'Some items are no longer available' USING ERRCODE = '22023';
  END IF;

  IF restaurant_count <> 1 THEN
    RAISE EXCEPTION 'All items must come from the same restaurant' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT menu_item_id, SUM(quantity)::integer AS quantity
    FROM jsonb_to_recordset(_items) AS item(menu_item_id uuid, quantity integer)
    GROUP BY menu_item_id
  )
  SELECT
    restaurants.name,
    ROUND(SUM(menu_items.price * requested.quantity), 2),
    jsonb_agg(jsonb_build_object(
      'item_name', menu_items.name,
      'item_price', ROUND(menu_items.price, 2),
      'quantity', requested.quantity
    ))
  INTO restaurant_name, rounded_subtotal, item_lines
  FROM requested
  JOIN public.menu_items ON menu_items.id = requested.menu_item_id
  JOIN public.restaurants ON restaurants.id = menu_items.restaurant_id
  GROUP BY restaurants.id, restaurants.name;

  calculated_total := ROUND(rounded_subtotal + delivery_amount, 2);

  INSERT INTO public.orders (
    customer_name,
    phone_number,
    delivery_address,
    special_instructions,
    restaurant_id,
    restaurant_name,
    subtotal,
    delivery_fee,
    total,
    status,
    user_id,
    payment_method,
    payment_status,
    idempotency_key
  )
  VALUES (
    _customer_name,
    _phone_number,
    _delivery_address,
    NULLIF(_special_instructions, ''),
    restaurant_id,
    restaurant_name,
    rounded_subtotal,
    delivery_amount,
    calculated_total,
    'New',
    _user_id,
    _payment_method,
    'pending',
    _idempotency_key
  )
  ON CONFLICT (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO new_order_id;

  IF new_order_id IS NULL THEN
    SELECT * INTO existing_order
    FROM public.orders
    WHERE user_id = _user_id
      AND idempotency_key = _idempotency_key
    FOR UPDATE;

    RETURN QUERY SELECT
      existing_order.id,
      existing_order.subtotal,
      existing_order.delivery_fee,
      existing_order.total;
    RETURN;
  END IF;

  INSERT INTO public.order_items (order_id, item_name, item_price, quantity)
  SELECT
    new_order_id,
    line.item_name,
    line.item_price,
    line.quantity
  FROM jsonb_to_recordset(item_lines) AS line(
    item_name text,
    item_price numeric,
    quantity integer
  );

  RETURN QUERY SELECT new_order_id, rounded_subtotal, delivery_amount, calculated_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(
  _order_id uuid,
  _new_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor uuid := auth.uid();
  current_order public.orders%ROWTYPE;
  allowed boolean := false;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF _new_status NOT IN (
    'New', 'Accepted', 'Preparing', 'Ready', 'Picked Up',
    'On the Way', 'Delivered', 'Cancelled'
  ) THEN
    RAISE EXCEPTION 'Invalid order status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF public.has_role(actor, 'admin') THEN
    allowed := true;
  ELSIF public.has_role(actor, 'restaurant_owner')
    AND public.owns_restaurant(actor, current_order.restaurant_id) THEN
    allowed := (
      (current_order.status = 'New' AND _new_status = 'Accepted') OR
      (current_order.status = 'Accepted' AND _new_status = 'Preparing') OR
      (current_order.status = 'Preparing' AND _new_status = 'Ready')
    );
  ELSIF public.has_role(actor, 'deliverer')
    AND current_order.deliverer_id = actor THEN
    allowed := (
      (current_order.status = 'Ready' AND _new_status = 'Picked Up') OR
      (current_order.status = 'Picked Up' AND _new_status = 'On the Way') OR
      (current_order.status = 'On the Way' AND _new_status = 'Delivered')
    );
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'You are not allowed to make this status change' USING ERRCODE = '42501';
  END IF;

  UPDATE public.orders SET status = _new_status WHERE id = _order_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_order_deliverer(
  _order_id uuid,
  _deliverer_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.has_role(actor, 'admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = _order_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF _deliverer_id IS NOT NULL
    AND NOT public.has_role(_deliverer_id, 'deliverer') THEN
    RAISE EXCEPTION 'The selected user is not a deliverer' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET deliverer_id = _deliverer_id
  WHERE id = _order_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_paid(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.has_role(actor, 'admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.orders
  SET payment_status = 'paid', paid_at = now()
  WHERE id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.switch_order_to_cash(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor uuid := auth.uid();
  current_order public.orders%ROWTYPE;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO current_order
  FROM public.orders
  WHERE id = _order_id
    AND user_id = actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF current_order.payment_method <> 'card'
    OR current_order.payment_status = 'paid'
    OR current_order.status IN ('Delivered', 'Cancelled') THEN
    RAISE EXCEPTION 'This order cannot be changed to cash' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET payment_method = 'cash',
      payment_status = 'pending',
      payment_reference = NULL,
      paid_at = NULL
  WHERE id = _order_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_atomic(text, text, text, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_order_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_order_deliverer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_order_paid(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.switch_order_to_cash(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(text, text, text, text, text, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_order_deliverer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_order_to_cash(uuid) TO authenticated, service_role;
