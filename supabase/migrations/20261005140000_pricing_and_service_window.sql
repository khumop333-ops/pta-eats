-- ============================================================================
-- ROMA Pricing & Service Window
-- 2026-10-05
--
-- Closes the "two sources of truth for money" defect flagged in
-- docs/DISPATCH-MIGRATION-RUNBOOK.md, and completes G5 by making the service
-- window CONFIGURED DATA rather than literals baked into a function.
--
-- THE CORE IDEA: the client never computes money. It renders a quote returned by
-- `quote_order()`. The same function prices the order at placement time. One
-- implementation, two consumers, so the displayed total and the charged total
-- cannot diverge.
--
-- Why this mattered: the fee existed in FOUR places and agreed only by
-- coincidence —
--     src/pages/Checkout.tsx        const DELIVERY_FEE = 15
--     supabase/functions/create-order/index.ts  const DELIVERY_FEE = 15
--     orders.delivery_fee           NUMERIC DEFAULT 15.00
--     orders.delivery_fee_cents     INTEGER DEFAULT 1500
-- Four copies of one number is four chances to disagree with the customer's
-- receipt. Money is now stored as INTEGER CENTS everywhere, so it is exact —
-- the previous `Math.round(x * 100) / 100` float arithmetic is gone.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — SERVICE WINDOW AS CONFIGURATION
-- ============================================================================
-- Previously 08:00/16:00 Mon-Fri were literals inside
-- is_within_service_window(). The operator cannot change their own trading hours
-- without a migration, which is wrong. This makes it a single-row config table.
CREATE TABLE IF NOT EXISTS public.service_config (
  -- Single-row table. The boolean PK with a CHECK constraint is deliberate: it
  -- makes a second row structurally impossible rather than merely discouraged.
  id                            boolean PRIMARY KEY DEFAULT true CHECK (id),

  open_time                     time    NOT NULL DEFAULT time '08:00',
  close_time                    time    NOT NULL DEFAULT time '16:00',
  -- ISO day-of-week numbers: 1=Monday … 7=Sunday. Default is Mon-Fri.
  open_days                     integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  timezone                      text    NOT NULL DEFAULT 'Africa/Johannesburg',

  -- IMPORTANT DISTINCTION, deliberate and flagged for the operator:
  -- The window ALWAYS governs dispatch — a rider can never claim outside it.
  -- This flag governs only whether a customer may PLACE an order outside it.
  -- Default false: refuse politely at checkout rather than accept money for an
  -- order nobody can deliver. Set true if you want to take tomorrow's orders
  -- overnight; the order will simply sit as 'pending' until riders start.
  accept_orders_outside_window boolean NOT NULL DEFAULT false,

  updated_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT service_config_window_ordered CHECK (close_time > open_time),
  CONSTRAINT service_config_days_nonempty  CHECK (array_length(open_days, 1) BETWEEN 1 AND 7)
);

INSERT INTO public.service_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.service_config ENABLE ROW LEVEL SECURITY;

-- Readable by anyone: the storefront must be able to say "opens Monday 08:00"
-- to a logged-out visitor. There is no write policy at all, so it is editable
-- only by service_role / the dashboard.
DROP POLICY IF EXISTS "Service config is publicly readable" ON public.service_config;
CREATE POLICY "Service config is publicly readable"
  ON public.service_config FOR SELECT TO anon, authenticated USING (true);


-- ============================================================================
-- SECTION 2 — WINDOW FUNCTIONS
-- ============================================================================

-- Rewritten to read the config table instead of hardcoding times. Kept as the
-- same signature so claim_order() and section 12 of the dispatch migration
-- continue to work unchanged.
CREATE OR REPLACE FUNCTION public.is_within_service_window()
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.service_config c
     WHERE EXTRACT(ISODOW FROM (now() AT TIME ZONE c.timezone))::integer = ANY (c.open_days)
       AND (now() AT TIME ZONE c.timezone)::time >= c.open_time
       AND (now() AT TIME ZONE c.timezone)::time <= c.close_time
  )
$$;

REVOKE ALL ON FUNCTION public.is_within_service_window() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_within_service_window() TO anon, authenticated, service_role;

/**
 * Full service state for the UI, including when we next open.
 *
 * Returns jsonb so the client gets one object it can render directly instead of
 * re-deriving opening logic in JavaScript — which is how the two would drift.
 */
CREATE OR REPLACE FUNCTION public.service_availability()
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  c            public.service_config;
  v_now        timestamp;
  v_is_open    boolean;
  v_next_open  timestamptz;
  v_candidate  date;
  v_open_ts    timestamp;
  i            integer;
BEGIN
  SELECT * INTO c FROM public.service_config WHERE id;
  IF NOT FOUND THEN
    -- Fail open on CONFIGURATION errors only. A missing config row is a bug in
    -- our deployment, not a reason to stop the business trading.
    RETURN jsonb_build_object(
      'isOpen', true, 'canOrder', true, 'reason', 'config_missing',
      'opensAt', NULL, 'closesAt', NULL, 'nextOpenAt', NULL,
      'timezone', 'Africa/Johannesburg'
    );
  END IF;

  v_now := now() AT TIME ZONE c.timezone;

  v_is_open :=
        EXTRACT(ISODOW FROM v_now)::integer = ANY (c.open_days)
    AND v_now::time >= c.open_time
    AND v_now::time <= c.close_time;

  -- Walk forward up to 8 days to find the next opening moment. 8 covers the
  -- worst case of a single open day per week (today already closed).
  FOR i IN 0..7 LOOP
    v_candidate := (v_now + (i || ' days')::interval)::date;
    IF EXTRACT(ISODOW FROM v_candidate)::integer = ANY (c.open_days) THEN
      v_open_ts := v_candidate + c.open_time;
      IF v_open_ts > v_now THEN
        v_next_open := v_open_ts AT TIME ZONE c.timezone;
        EXIT;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'isOpen',      v_is_open,
    -- canOrder differs from isOpen only when the operator opts in to taking
    -- orders outside trading hours.
    'canOrder',    v_is_open OR c.accept_orders_outside_window,
    'reason',      CASE
                     WHEN v_is_open THEN 'open'
                     WHEN c.accept_orders_outside_window THEN 'closed_but_accepting'
                     ELSE 'closed'
                   END,
    'opensAt',     (v_now::date + c.open_time) AT TIME ZONE c.timezone,
    'closesAt',    (v_now::date + c.close_time) AT TIME ZONE c.timezone,
    'nextOpenAt',  v_next_open,
    'openTime',    to_char(c.open_time,  'HH24:MI'),
    'closeTime',   to_char(c.close_time, 'HH24:MI'),
    'openDays',    to_jsonb(c.open_days),
    'timezone',    c.timezone
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_availability() TO anon, authenticated, service_role;


-- ============================================================================
-- SECTION 3 — DELIVERY ZONES
-- ============================================================================
-- ⚠️  THE FEES BELOW ARE PLACEHOLDER OPERATOR DEFAULTS, NOT RESEARCHED PRICES.
--
-- They are a coarse distance-band model: Pretoria's geography is radial, so a
-- banded fee tracks distance well enough to launch and is far simpler to operate
-- than a per-kilometre formula. Suburb groupings follow the real layout
-- (Mamelodi ~16km east of Church Square, Atteridgeville west, Soshanguve/
-- Mabopane north-west, Centurion south).
--
-- WHAT IS MISSING: these are groupings, not geofences. There are no polygons and
-- no coordinates yet, so `orders.delivery_zone` is currently supplied by the
-- client and is therefore UNVERIFIED. The geo slice (G4) adds lat/lng, real
-- polygons, and server-side zone derivation. Until then the zone is a pricing
-- hint, not a boundary, and a caller could under-declare their zone.
--
-- ACTION FOR THE OPERATOR: set real prices before launch. Change the table, not
-- the code.
CREATE TABLE IF NOT EXISTS public.delivery_zones (
  code        text PRIMARY KEY,
  label       text    NOT NULL,
  fee_cents   integer NOT NULL CHECK (fee_cents >= 0),
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  notes       text
);

INSERT INTO public.delivery_zones (code, label, fee_cents, sort_order, notes) VALUES
  ('central', 'Pretoria Central', 1500, 1,
   'CBD, Sunnyside, Arcadia, Pretoria West, Salvokop'),
  ('east',    'East',             2500, 2,
   'Mamelodi, Eersterust, Silverton, Lynnwood, Menlyn, Hatfield, Brooklyn'),
  ('west',    'West',             2500, 3,
   'Atteridgeville, Saulsville, Laudium, Danville, Lotus Gardens'),
  ('south',   'South',            3000, 4,
   'Centurion, Waterkloof, Olievenhoutbosch'),
  ('north',   'North',            3500, 5,
   'Soshanguve, Mabopane, Ga-Rankuwa, Akasia, Rosslyn')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Delivery zones are publicly readable" ON public.delivery_zones;
CREATE POLICY "Delivery zones are publicly readable"
  ON public.delivery_zones FOR SELECT TO anon, authenticated USING (true);

-- Existing orders predate zones; give them the cheapest band rather than NULL so
-- reporting does not silently drop them.
ALTER TABLE public.orders ALTER COLUMN delivery_zone SET DEFAULT 'central';
UPDATE public.orders SET delivery_zone = 'central' WHERE delivery_zone IS NULL;

-- delivery_fee_cents is now the ONLY authoritative fee. Keep the legacy numeric
-- column in sync for anything still reading it, but derive it — never set it
-- independently again.
CREATE OR REPLACE FUNCTION public.sync_delivery_fee_numeric()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_fee_cents IS NOT NULL THEN
    NEW.delivery_fee := ROUND(NEW.delivery_fee_cents::numeric / 100, 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_delivery_fee ON public.orders;
CREATE TRIGGER trg_sync_delivery_fee
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_delivery_fee_numeric();


-- ============================================================================
-- SECTION 4 — THE SINGLE PRICING AUTHORITY
-- ============================================================================
/**
 * Price a basket. THE ONLY place order money is calculated.
 *
 * Called by:
 *   - the web client, to render the cart total       (display)
 *   - create-order, to persist the order             (charge)
 * If these two ever disagree, the customer is quoted one number and charged
 * another. They cannot disagree, because there is one implementation.
 *
 * p_items: jsonb array of { menuItemId: uuid, quantity: int }
 * p_zone:  delivery zone code, or NULL for 'central'
 *
 * Returns jsonb:
 *   { ok, error?, items[], subtotalCents, deliveryFeeCents, totalCents,
 *     zone, restaurantId, restaurantName, service{...} }
 *
 * Prices are read from menu_items, never from the caller. The client sends only
 * WHAT it wants, never what it costs.
 */
CREATE OR REPLACE FUNCTION public.quote_order(p_items jsonb, p_zone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_zone_code   text;
  v_zone        public.delivery_zones;
  v_service     jsonb;
  v_items       jsonb := '[]'::jsonb;
  v_subtotal    integer := 0;
  v_line        integer;
  v_restaurants integer[];
  v_line_item   record;   -- iteration variable — kept DISTINCT from the lookup
  v_menu        record;   -- below, because reusing one record for both silently
                          -- discards the loop's own columns.
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_basket');
  END IF;

  IF jsonb_array_length(p_items) > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'basket_too_large');
  END IF;

  v_zone_code := COALESCE(NULLIF(btrim(p_zone), ''), 'central');

  SELECT * INTO v_zone FROM public.delivery_zones WHERE code = v_zone_code AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_zone', 'zone', v_zone_code);
  END IF;

  v_service := public.service_availability();

  -- Resolve every line against live menu data.
  FOR v_line_item IN
    SELECT e->>'menuItemId' AS raw_id,
           GREATEST(1, LEAST(50, COALESCE((e->>'quantity')::integer, 1))) AS quantity
      FROM jsonb_array_elements(p_items) e
  LOOP
    -- Validate the UUID as TEXT before casting. A malformed id from a buggy or
    -- hostile client would otherwise raise 'invalid input syntax for type uuid',
    -- which tells the caller nothing and looks like a server fault.
    IF v_line_item.raw_id IS NULL
       OR v_line_item.raw_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_item');
    END IF;

    SELECT mi.id, mi.name, mi.price, mi.restaurant_id, r.name AS restaurant_name
      INTO v_menu
      FROM public.menu_items mi
      JOIN public.restaurants r ON r.id = mi.restaurant_id
     WHERE mi.id = v_line_item.raw_id::uuid;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_unavailable');
    END IF;

    -- menu_items.price is NUMERIC(10,2) in rands. Convert to exact integer cents
    -- exactly once, here, and do all arithmetic in cents thereafter.
    v_line := ROUND(v_menu.price * 100)::integer * v_line_item.quantity;
    v_subtotal := v_subtotal + v_line;

    v_items := v_items || jsonb_build_object(
      'menuItemId',     v_menu.id,
      'name',           v_menu.name,
      'unitPriceCents', ROUND(v_menu.price * 100)::integer,
      'quantity',       v_line_item.quantity,
      'lineTotalCents', v_line,
      'restaurantId',   v_menu.restaurant_id,
      'restaurantName', v_menu.restaurant_name
    );
  END LOOP;

  -- An order must be collectable from one kitchen. Checking inside the quote means
  -- the client is told before the customer pays, not after.
  SELECT array_agg(DISTINCT (e->>'restaurantId')::integer)
    INTO v_restaurants
    FROM jsonb_array_elements(v_items) e;

  IF v_restaurants IS NULL OR array_length(v_restaurants, 1) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mixed_restaurants');
  END IF;

  RETURN jsonb_build_object(
    'ok',               true,
    'items',            v_items,
    'subtotalCents',    v_subtotal,
    'deliveryFeeCents', v_zone.fee_cents,
    'totalCents',       v_subtotal + v_zone.fee_cents,
    'zone',             v_zone.code,
    'zoneLabel',        v_zone.label,
    'restaurantId',     v_restaurants[1],
    'service',          v_service,
    -- The client renders this to decide whether to show the Pay button. It is
    -- NOT the enforcement point: create-order re-checks server-side.
    'canPlaceOrder',    (v_service->>'canOrder')::boolean
  );
END;
$$;

REVOKE ALL ON FUNCTION public.quote_order(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_order(jsonb, text) TO anon, authenticated, service_role;


-- ============================================================================
-- SECTION 5 — ORDER STATUS: ACCEPT THE CANONICAL VOCABULARY ONLY
-- ============================================================================
-- The dispatch migration set the DEFAULT to 'pending', but create-order was still
-- explicitly writing status 'New' — a literal the new CHECK constraint rejects.
-- That single line broke order placement entirely.
--
-- A DEFAULT does not protect you when the caller passes a value explicitly, and a
-- CHECK constraint cannot tell you WHICH caller is wrong. This adds the missing
-- diagnostic: a clear, actionable error naming the offending value, so the next
-- person to make this mistake gets a sentence instead of a constraint violation.
CREATE OR REPLACE FUNCTION public.explain_status_check()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT NULL
     AND NEW.status NOT IN ('pending','accepted','preparing','ready',
                            'assigned','picked_up','delivered','cancelled','failed')
  THEN
    RAISE EXCEPTION
      'Invalid order status %. The canonical values are lowercase: pending, accepted, preparing, ready, assigned, picked_up, delivered, cancelled, failed. See src/domain/order/status.ts.',
      NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_explain_status_check ON public.orders;
CREATE TRIGGER trg_explain_status_check
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.explain_status_check();
