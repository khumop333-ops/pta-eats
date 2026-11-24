-- Campaigns, referral program & per-restaurant delivery fees (24 Nov 2026)
--
-- 1. Per-restaurant delivery fee on public.restaurants (default R20; R15 for Magwinya Zone).
-- 2. Sign-up free first delivery campaign + referral tracking on public.profiles:
--      * Every new signup receives 1 free delivery credit (free_delivery_credits = 1)
--        and a unique referral_code (e.g. ROMA-7K3P9X).
--      * Referrers earn +1 free delivery credit once a referred friend completes
--        their first order.
-- 3. Audit & anti-tampering:
--      * public.referrals tracks referred signups ('pending_first_order' -> 'rewarded').
--      * public.delivery_credit_redemptions records verified FD-XXXXXX promo codes
--        included in WhatsApp / checkout orders.
--      * protect_profile_reward_columns trigger blocks direct client edits to
--        credit/referral columns on public.profiles.

-- ---------------------------------------------------------------------------
-- 1. Per-restaurant delivery fees
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 20.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'restaurants_delivery_fee_non_negative'
      AND conrelid = 'public.restaurants'::regclass
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_delivery_fee_non_negative CHECK (delivery_fee >= 0);
  END IF;
END;
$$;

UPDATE public.restaurants
SET delivery_fee = 15.00
WHERE slug = 'magwinya-zone';

-- ---------------------------------------------------------------------------
-- 2. Profile columns for free delivery credits & referrals
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS free_delivery_credits INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS orders_placed_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_free_delivery_credits_non_negative'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_free_delivery_credits_non_negative CHECK (free_delivery_credits >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_orders_placed_count_non_negative'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_orders_placed_count_non_negative CHECK (orders_placed_count >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_unique_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_candidate TEXT;
BEGIN
  LOOP
    v_candidate := 'ROMA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.referral_code = v_candidate
    );
  END LOOP;
  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_unique_referral_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_unique_referral_code() TO service_role;

-- Backfill referral_code on any existing profiles before adding NOT NULL + UNIQUE.
DO $$
DECLARE
  v_profile RECORD;
BEGIN
  PERFORM pg_catalog.set_config('app.allow_profile_reward_update', 'true', true);

  FOR v_profile IN
    SELECT id
    FROM public.profiles
    WHERE referral_code IS NULL OR btrim(referral_code) = ''
  LOOP
    UPDATE public.profiles
    SET referral_code = public.generate_unique_referral_code()
    WHERE id = v_profile.id;
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN referral_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON public.profiles (referral_code);

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 3. Referrals & delivery credit redemption tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending_first_order'
    CHECK (status IN ('pending_first_order', 'rewarded')),
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self_referral CHECK (referrer_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx
  ON public.referrals (referrer_id, created_at DESC);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own referrals" ON public.referrals;
CREATE POLICY "Users can view own referrals"
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

DROP POLICY IF EXISTS "Admins can view all referrals" ON public.referrals;
CREATE POLICY "Admins can view all referrals"
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.delivery_credit_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  promo_code TEXT NOT NULL UNIQUE,
  restaurant_slug TEXT,
  restaurant_name TEXT NOT NULL,
  saved_amount NUMERIC(10, 2) NOT NULL CHECK (saved_amount >= 0),
  order_subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (order_subtotal >= 0),
  customer_name TEXT,
  customer_phone TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_credit_redemptions_user_id_idx
  ON public.delivery_credit_redemptions (user_id, created_at DESC);

ALTER TABLE public.delivery_credit_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own redemptions" ON public.delivery_credit_redemptions;
CREATE POLICY "Users can view own redemptions"
  ON public.delivery_credit_redemptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all redemptions" ON public.delivery_credit_redemptions;
CREATE POLICY "Admins can view all redemptions"
  ON public.delivery_credit_redemptions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 4. Protect reward & referral columns on public.profiles from client edits
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_reward_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Trusted server / trigger / RPC / admin contexts
  IF auth.uid() IS NULL
     OR public.has_role(auth.uid(), 'admin')
     OR coalesce(pg_catalog.current_setting('app.allow_profile_reward_update', true), '') = 'true'
  THEN
    IF TG_OP = 'INSERT' AND (NEW.referral_code IS NULL OR btrim(NEW.referral_code) = '') THEN
      NEW.referral_code := public.generate_unique_referral_code();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.referral_code := public.generate_unique_referral_code();
    NEW.referred_by_user_id := NULL;
    NEW.free_delivery_credits := 1;
    NEW.orders_placed_count := 0;
    RETURN NEW;
  END IF;

  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.referred_by_user_id IS DISTINCT FROM OLD.referred_by_user_id
     OR NEW.free_delivery_credits IS DISTINCT FROM OLD.free_delivery_credits
     OR NEW.orders_placed_count IS DISTINCT FROM OLD.orders_placed_count
  THEN
    RAISE EXCEPTION 'cannot edit reward or referral columns'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_reward_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_profile_reward_columns() TO service_role;

DROP TRIGGER IF EXISTS profiles_protect_rewards ON public.profiles;
CREATE TRIGGER profiles_protect_rewards
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_reward_columns();

-- ---------------------------------------------------------------------------
-- 5. Signup trigger: grant 1st free delivery + link optional referral code
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name TEXT;
  v_first_name TEXT;
  v_raw_ref TEXT;
  v_referrer_id UUID;
  v_new_code TEXT;
BEGIN
  PERFORM pg_catalog.set_config('app.allow_profile_reward_update', 'true', true);

  v_full_name := btrim(coalesce(NEW.raw_user_meta_data->>'full_name', ''));
  v_first_name := nullif(split_part(v_full_name, ' ', 1), '');
  v_raw_ref := upper(btrim(coalesce(NEW.raw_user_meta_data->>'referral_code', '')));
  v_new_code := public.generate_unique_referral_code();

  IF v_raw_ref <> '' THEN
    SELECT p.id
    INTO v_referrer_id
    FROM public.profiles p
    WHERE upper(p.referral_code) = v_raw_ref
      AND p.id <> NEW.id
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (
    id,
    full_name,
    referral_code,
    referred_by_user_id,
    free_delivery_credits,
    orders_placed_count
  )
  VALUES (
    NEW.id,
    v_full_name,
    v_new_code,
    v_referrer_id,
    1,
    0
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.referrals (
      referrer_id,
      referred_user_id,
      referred_name,
      status
    )
    VALUES (
      v_referrer_id,
      NEW.id,
      v_first_name,
      'pending_first_order'
    )
    ON CONFLICT (referred_user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. RPCs: apply referral code after signup + redeem credit / reward referrer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referral_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_clean_code TEXT;
  v_referrer_id UUID;
  v_existing_referrer UUID;
  v_orders_count INTEGER;
  v_full_name TEXT;
  v_first_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_clean_code := upper(btrim(coalesce(p_referral_code, '')));
  IF v_clean_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please enter a referral code.');
  END IF;

  PERFORM pg_catalog.set_config('app.allow_profile_reward_update', 'true', true);

  SELECT referred_by_user_id, orders_placed_count, coalesce(full_name, '')
  INTO v_existing_referrer, v_orders_count, v_full_name
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profile not found.');
  END IF;

  IF v_existing_referrer IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A referral code has already been linked to your account.');
  END IF;

  IF v_orders_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Referral codes can only be added before your first order.');
  END IF;

  SELECT p.id
  INTO v_referrer_id
  FROM public.profiles p
  WHERE upper(p.referral_code) = v_clean_code
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'We could not find that referral code.');
  END IF;

  IF v_referrer_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You cannot use your own referral code.');
  END IF;

  v_first_name := nullif(split_part(btrim(v_full_name), ' ', 1), '');

  UPDATE public.profiles
  SET referred_by_user_id = v_referrer_id
  WHERE id = v_uid;

  INSERT INTO public.referrals (
    referrer_id,
    referred_user_id,
    referred_name,
    status
  )
  VALUES (
    v_referrer_id,
    v_uid,
    v_first_name,
    'pending_first_order'
  )
  ON CONFLICT (referred_user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_user_order_promo(
  p_user_id UUID,
  p_restaurant_slug TEXT,
  p_restaurant_name TEXT,
  p_subtotal NUMERIC,
  p_standard_delivery_fee NUMERIC,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_order_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_credits INTEGER;
  v_orders_count INTEGER;
  v_prof_name TEXT;
  v_prof_phone TEXT;
  v_promo_code TEXT;
  v_redeemed BOOLEAN := false;
  v_saved NUMERIC(10, 2) := 0;
  v_referrer_id UUID;
  v_referral_rewarded BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.allow_profile_reward_update', 'true', true);

  SELECT free_delivery_credits, orders_placed_count, full_name, phone_number
  INTO v_credits, v_orders_count, v_prof_name, v_prof_phone
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (
      id,
      full_name,
      phone_number,
      referral_code,
      free_delivery_credits,
      orders_placed_count
    )
    VALUES (
      p_user_id,
      nullif(btrim(coalesce(p_customer_name, '')), ''),
      nullif(btrim(coalesce(p_customer_phone, '')), ''),
      public.generate_unique_referral_code(),
      1,
      0
    )
    RETURNING free_delivery_credits, orders_placed_count, full_name, phone_number
    INTO v_credits, v_orders_count, v_prof_name, v_prof_phone;
  END IF;

  IF v_credits > 0 AND coalesce(p_standard_delivery_fee, 0) > 0 THEN
    LOOP
      v_promo_code := 'FD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.delivery_credit_redemptions r
        WHERE r.promo_code = v_promo_code
      );
    END LOOP;

    v_credits := v_credits - 1;
    v_redeemed := true;
    v_saved := round(p_standard_delivery_fee, 2);

    INSERT INTO public.delivery_credit_redemptions (
      user_id,
      promo_code,
      restaurant_slug,
      restaurant_name,
      saved_amount,
      order_subtotal,
      customer_name,
      customer_phone,
      order_id
    )
    VALUES (
      p_user_id,
      v_promo_code,
      nullif(btrim(coalesce(p_restaurant_slug, '')), ''),
      coalesce(nullif(btrim(coalesce(p_restaurant_name, '')), ''), 'Roma'),
      v_saved,
      greatest(0, round(coalesce(p_subtotal, 0), 2)),
      nullif(btrim(coalesce(p_customer_name, '')), ''),
      nullif(btrim(coalesce(p_customer_phone, '')), ''),
      p_order_id
    );
  END IF;

  UPDATE public.profiles
  SET free_delivery_credits = v_credits,
      orders_placed_count = v_orders_count + 1,
      full_name = CASE
        WHEN (v_prof_name IS NULL OR btrim(v_prof_name) = '')
             AND nullif(btrim(coalesce(p_customer_name, '')), '') IS NOT NULL
        THEN btrim(p_customer_name)
        ELSE v_prof_name
      END,
      phone_number = CASE
        WHEN (v_prof_phone IS NULL OR btrim(v_prof_phone) = '')
             AND nullif(btrim(coalesce(p_customer_phone, '')), '') IS NOT NULL
        THEN btrim(p_customer_phone)
        ELSE v_prof_phone
      END
  WHERE id = p_user_id;

  -- Unlock referrer's free delivery credit on the referred friend's first order.
  UPDATE public.referrals
  SET status = 'rewarded',
      rewarded_at = now()
  WHERE referred_user_id = p_user_id
    AND status = 'pending_first_order'
  RETURNING referrer_id INTO v_referrer_id;

  IF v_referrer_id IS NOT NULL THEN
    UPDATE public.profiles
    SET free_delivery_credits = free_delivery_credits + 1
    WHERE id = v_referrer_id;
    v_referral_rewarded := true;
  END IF;

  RETURN jsonb_build_object(
    'redeemed', v_redeemed,
    'promo_code', v_promo_code,
    'saved_amount', v_saved,
    'remaining_credits', v_credits,
    'referral_rewarded', v_referral_rewarded
  );
END;
$$;

-- Internal helper: callable only by service_role (Edge Functions) or via complete_whatsapp_order_promo.
REVOKE ALL ON FUNCTION public.process_user_order_promo(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_user_order_promo(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_order_promo(
  p_restaurant_slug TEXT,
  p_restaurant_name TEXT,
  p_subtotal NUMERIC,
  p_standard_delivery_fee NUMERIC,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN public.process_user_order_promo(
    v_uid,
    p_restaurant_slug,
    p_restaurant_name,
    p_subtotal,
    p_standard_delivery_fee,
    p_customer_name,
    p_customer_phone,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_whatsapp_order_promo(TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_order_promo(TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT)
  TO authenticated, service_role;
