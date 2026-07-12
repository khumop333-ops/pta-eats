ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'restaurant_owner';

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS restaurants_owner_id_idx ON public.restaurants(owner_id);

CREATE OR REPLACE FUNCTION public.owns_restaurant(_user_id UUID, _restaurant_id INTEGER)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.restaurants WHERE id = _restaurant_id AND owner_id = _user_id)
$$;

DROP POLICY IF EXISTS "Owners can update their restaurant" ON public.restaurants;
CREATE POLICY "Owners can update their restaurant" ON public.restaurants FOR UPDATE
  TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners manage their menu items - insert" ON public.menu_items;
CREATE POLICY "Owners manage their menu items - insert" ON public.menu_items FOR INSERT
  TO authenticated WITH CHECK (public.owns_restaurant(auth.uid(), restaurant_id));

DROP POLICY IF EXISTS "Owners manage their menu items - update" ON public.menu_items;
CREATE POLICY "Owners manage their menu items - update" ON public.menu_items FOR UPDATE
  TO authenticated USING (public.owns_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.owns_restaurant(auth.uid(), restaurant_id));

DROP POLICY IF EXISTS "Owners manage their menu items - delete" ON public.menu_items;
CREATE POLICY "Owners manage their menu items - delete" ON public.menu_items FOR DELETE
  TO authenticated USING (public.owns_restaurant(auth.uid(), restaurant_id));

DROP POLICY IF EXISTS "Owners can view their restaurant orders" ON public.orders;
CREATE POLICY "Owners can view their restaurant orders" ON public.orders FOR SELECT
  TO authenticated USING (restaurant_id IS NOT NULL AND public.owns_restaurant(auth.uid(), restaurant_id));

DROP POLICY IF EXISTS "Owners can update their restaurant orders" ON public.orders;
CREATE POLICY "Owners can update their restaurant orders" ON public.orders FOR UPDATE
  TO authenticated USING (restaurant_id IS NOT NULL AND public.owns_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (restaurant_id IS NOT NULL AND public.owns_restaurant(auth.uid(), restaurant_id));

DROP POLICY IF EXISTS "Owners can view their restaurant order items" ON public.order_items;
CREATE POLICY "Owners can view their restaurant order items" ON public.order_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
      AND o.restaurant_id IS NOT NULL AND public.owns_restaurant(auth.uid(), o.restaurant_id))
  );